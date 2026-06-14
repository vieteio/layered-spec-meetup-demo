"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocumentRunEvent } from "@/server/types";

type DocumentUpdatesContextValue = {
  latestEvent: DocumentRunEvent | null;
  clearLatestEvent: () => void;
  subscribeDocument: (documentId: string) => void;
  subscribeAllDocuments: () => void;
};

const DocumentUpdatesContext =
  createContext<DocumentUpdatesContextValue | null>(null);

function getWebSocketUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsPort = process.env.NEXT_PUBLIC_WS_PORT;

  if (wsPort) {
    return `${protocol}//${window.location.hostname}:${wsPort}`;
  }

  return `${protocol}//${window.location.host}/api/updates/ws`;
}

export function DocumentUpdatesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const [latestEvent, setLatestEvent] = useState<DocumentRunEvent | null>(null);

  const connect = useCallback(() => {
    const url = getWebSocketUrl();
    if (!url) {
      return;
    }

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ action: "subscribe_all_documents" }));
    };

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as {
          type?: string;
          documentId?: string;
          processingRunId?: string;
          status?: DocumentRunEvent["status"];
          occurredAt?: string;
          failureStage?: DocumentRunEvent["failureStage"];
          failureMessage?: string | null;
        };

        if (
          payload.type === "document.run.updated" ||
          payload.type === "document.run.completed" ||
          payload.type === "document.run.failed"
        ) {
          setLatestEvent({
            type: payload.type,
            documentId: payload.documentId ?? "",
            processingRunId: payload.processingRunId ?? "",
            status: payload.status ?? "queued",
            occurredAt: payload.occurredAt ?? new Date().toISOString(),
            failureStage: payload.failureStage ?? null,
            failureMessage: payload.failureMessage ?? null,
          });
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    };

    socket.onclose = () => {
      window.setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);

  const subscribeDocument = useCallback((documentId: string) => {
    socketRef.current?.send(
      JSON.stringify({ action: "subscribe_document", documentId }),
    );
  }, []);

  const subscribeAllDocuments = useCallback(() => {
    socketRef.current?.send(
      JSON.stringify({ action: "subscribe_all_documents" }),
    );
  }, []);

  const value = useMemo(
    () => ({
      latestEvent,
      clearLatestEvent: () => setLatestEvent(null),
      subscribeDocument,
      subscribeAllDocuments,
    }),
    [latestEvent, subscribeDocument, subscribeAllDocuments],
  );

  return (
    <DocumentUpdatesContext.Provider value={value}>
      {children}
    </DocumentUpdatesContext.Provider>
  );
}

export function useDocumentUpdates(): DocumentUpdatesContextValue {
  const context = useContext(DocumentUpdatesContext);
  if (!context) {
    throw new Error("useDocumentUpdates must be used within DocumentUpdatesProvider");
  }
  return context;
}
