"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { DocumentStatusToast } from "@/components/DocumentStatusToast";
import { useDocumentUpdates } from "@/components/providers/DocumentUpdatesProvider";
import type { DocumentListItem } from "@/server/types";

export function DocumentsWorkspace() {
  const router = useRouter();
  const { latestEvent, clearLatestEvent, subscribeAllDocuments } =
    useDocumentUpdates();
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/documents");
    if (response.status === 401) {
      router.replace("/");
      return;
    }

    const data = (await response.json()) as { documents: DocumentListItem[] };
    setDocuments(data.documents);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void loadDocuments();
    subscribeAllDocuments();
  }, [loadDocuments, subscribeAllDocuments]);

  useEffect(() => {
    if (!latestEvent) {
      return;
    }
    void loadDocuments();
  }, [latestEvent, loadDocuments]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setUploading(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const response = await fetch("/api/documents", {
      method: "POST",
      body: formData,
    });

    setUploading(false);

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Upload failed");
      return;
    }

    const created = (await response.json()) as DocumentListItem;
    form.reset();
    router.push(`/documents/${created.id}`);
  }

  return (
    <main>
      <DocumentStatusToast event={latestEvent} onDismiss={clearLatestEvent} />
      <section className="panel stack">
        <div className="header">
          <div>
            <h1>Your documents</h1>
            <p className="muted">
              Upload construction drawing PDFs up to 32 MB and track processing
              live.
            </p>
          </div>
          <form action="/api/logout" method="post">
            <button className="button secondary" type="submit">
              Log out
            </button>
          </form>
        </div>

        <form className="stack" onSubmit={handleUpload}>
          <label>
            <span className="muted">Select a PDF to process</span>
            <input accept="application/pdf,.pdf" name="file" required type="file" />
          </label>
          <button className="button" disabled={uploading} type="submit">
            {uploading ? "Uploading..." : "Upload and process"}
          </button>
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        </form>

        {loading ? (
          <p className="muted">Loading documents...</p>
        ) : documents.length === 0 ? (
          <p className="muted">No processed PDFs yet.</p>
        ) : (
          <div className="document-list">
            {documents.map((document) => (
              <div className="document-row" key={document.id}>
                <div>
                  <Link href={`/documents/${document.id}`}>
                    <strong>{document.originalFilename}</strong>
                  </Link>
                  <div className="muted">
                    Updated {new Date(document.updatedAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`status ${
                    document.status === "failed"
                      ? "failed"
                      : document.status === "completed"
                        ? "completed"
                        : ""
                  }`}
                >
                  {document.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
