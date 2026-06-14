import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { prisma } from "@/server/db/prisma";
import {
  getAuthenticatedUserFromToken,
  hashSessionTokenForLookup,
} from "@/server/auth/sessionWs";
import type { DocumentRunEvent, ProcessingStatus } from "@/server/types";

type ClientState = {
  userId: string;
  subscribedDocumentIds: Set<string>;
  subscribeAllDocuments: boolean;
};

const clients = new Map<WebSocket, ClientState>();

function eventForRun(params: {
  type: DocumentRunEvent["type"];
  documentId: string;
  processingRunId: string;
  status: ProcessingStatus;
  failureStage?: string | null;
  failureMessage?: string | null;
}): DocumentRunEvent {
  return {
    type: params.type,
    documentId: params.documentId,
    processingRunId: params.processingRunId,
    status: params.status,
    occurredAt: new Date().toISOString(),
    failureStage:
      (params.failureStage as DocumentRunEvent["failureStage"]) ?? null,
    failureMessage: params.failureMessage ?? null,
  };
}

function shouldDeliver(client: ClientState, documentId: string): boolean {
  return (
    client.subscribeAllDocuments || client.subscribedDocumentIds.has(documentId)
  );
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/** Implements: broadcast committed run updates to subscribed sockets. */
export function publishDocumentRunEvent(params: {
  userId: string;
  documentId: string;
  processingRunId: string;
  status: ProcessingStatus;
  failureStage?: string | null;
  failureMessage?: string | null;
}): void {
  const type: DocumentRunEvent["type"] =
    params.status === "completed"
      ? "document.run.completed"
      : params.status === "failed"
        ? "document.run.failed"
        : "document.run.updated";

  const payload = eventForRun({ ...params, type });

  for (const [socket, client] of clients.entries()) {
    if (client.userId !== params.userId) {
      continue;
    }
    if (!shouldDeliver(client, params.documentId)) {
      continue;
    }
    send(socket, payload);
  }
}

async function authorizeDocumentSubscription(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  return Boolean(document);
}

export async function handleWebSocketConnection(
  ws: WebSocket,
  request: IncomingMessage,
): Promise<void> {
  const cookieHeader = request.headers.cookie ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("session="))
    ?.slice("session=".length);

  if (!token) {
    ws.close(4401, "Unauthorized");
    return;
  }

  const user = await getAuthenticatedUserFromToken(token);
  if (!user) {
    ws.close(4401, "Unauthorized");
    return;
  }

  const state: ClientState = {
    userId: user.id,
    subscribedDocumentIds: new Set(),
    subscribeAllDocuments: true,
  };
  clients.set(ws, state);

  ws.on("message", async (raw) => {
    try {
      const message = JSON.parse(String(raw)) as {
        action: "subscribe_all_documents" | "subscribe_document" | "unsubscribe_document";
        documentId?: string | null;
      };

      if (message.action === "subscribe_all_documents") {
        state.subscribeAllDocuments = true;
        return;
      }

      if (message.action === "subscribe_document" && message.documentId) {
        const allowed = await authorizeDocumentSubscription(
          user.id,
          message.documentId,
        );
        if (!allowed) {
          send(ws, { type: "error", message: "Unauthorized subscription" });
          return;
        }
        state.subscribedDocumentIds.add(message.documentId);
        state.subscribeAllDocuments = false;
        return;
      }

      if (message.action === "unsubscribe_document" && message.documentId) {
        state.subscribedDocumentIds.delete(message.documentId);
      }
    } catch {
      send(ws, { type: "error", message: "Invalid subscription message" });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });

  send(ws, { type: "connected", userId: user.id });
}
