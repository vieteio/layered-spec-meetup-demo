"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DocumentStatusToast } from "@/components/DocumentStatusToast";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { useDocumentUpdates } from "@/components/providers/DocumentUpdatesProvider";
import type { DocumentDetailResponse } from "@/server/types";

type Tab = "parsed" | "estimation";

const ACTIVE_STATUSES = new Set([
  "queued",
  "parsing",
  "parsed",
  "estimating",
]);

export function DocumentDetailView() {
  const params = useParams<{ documentId: string }>();
  const router = useRouter();
  const documentId = params.documentId;
  const { latestEvent, clearLatestEvent, subscribeDocument } =
    useDocumentUpdates();
  const [detail, setDetail] = useState<DocumentDetailResponse | null>(null);
  const [tab, setTab] = useState<Tab>("estimation");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    const response = await fetch(`/api/documents/${documentId}`);
    if (response.status === 401) {
      router.replace("/");
      return;
    }
    if (response.status === 404) {
      setDetail(null);
      return;
    }

    const body = (await response.json()) as DocumentDetailResponse;
    setDetail(body);
  }, [documentId, router]);

  useEffect(() => {
    subscribeDocument(documentId);
    void loadDetail();
  }, [documentId, loadDetail, subscribeDocument]);

  useEffect(() => {
    if (!latestEvent || latestEvent.documentId !== documentId) {
      return;
    }
    void loadDetail();
  }, [documentId, latestEvent, loadDetail]);

  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.has(detail.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadDetail();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [detail, loadDetail]);

  async function handleReprocess() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/reprocess`, {
      method: "POST",
    });
    setBusy(false);

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Reprocess failed");
      return;
    }

    await loadDetail();
  }

  async function handleDelete() {
    if (!window.confirm("Delete this PDF and its processing history?")) {
      return;
    }

    setBusy(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE",
    });
    setBusy(false);

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Delete failed");
      return;
    }

    router.push("/documents");
  }

  if (!detail) {
    return (
      <main>
        <p className="muted">Loading document...</p>
      </main>
    );
  }

  const canDelete =
    detail.status === "completed" || detail.status === "failed";

  return (
    <main>
      <DocumentStatusToast
        event={
          latestEvent?.documentId === documentId ? latestEvent : null
        }
        onDismiss={clearLatestEvent}
      />
      <section className="panel stack">
        <div className="header">
          <div>
            <Link className="muted" href="/documents">
              Back to documents
            </Link>
            <h1>{detail.originalFilename}</h1>
            <span
              className={`status ${
                detail.status === "failed"
                  ? "failed"
                  : detail.status === "completed"
                    ? "completed"
                    : ""
              }`}
            >
              {detail.status}
            </span>
          </div>
          <div className="stack" style={{ width: "auto" }}>
            <button
              className="button secondary"
              disabled={busy}
              onClick={handleReprocess}
              type="button"
            >
              Reprocess
            </button>
            <button
              className="button danger"
              disabled={busy || !canDelete}
              onClick={handleDelete}
              type="button"
            >
              Delete
            </button>
          </div>
        </div>

        {detail.failureMessage ? (
          <p style={{ color: "var(--danger)" }}>{detail.failureMessage}</p>
        ) : null}
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

        <div className="tabs">
          <button
            className={`tab ${tab === "parsed" ? "active" : ""}`}
            onClick={() => setTab("parsed")}
            type="button"
          >
            Parsed markdown
          </button>
          <button
            className={`tab ${tab === "estimation" ? "active" : ""}`}
            onClick={() => setTab("estimation")}
            type="button"
          >
            Estimation markdown
          </button>
        </div>

        {tab === "parsed" ? (
          detail.parsedMarkdown ? (
            <MarkdownViewer markdown={detail.parsedMarkdown} />
          ) : (
            <p className="muted">Parsed markdown is not available yet.</p>
          )
        ) : detail.estimationMarkdown ? (
          <MarkdownViewer markdown={detail.estimationMarkdown} />
        ) : (
          <p className="muted">Estimation markdown is not available yet.</p>
        )}
      </section>
    </main>
  );
}
