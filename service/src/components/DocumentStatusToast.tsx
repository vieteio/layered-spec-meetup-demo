"use client";

import type { DocumentRunEvent } from "@/server/types";

export function DocumentStatusToast({
  event,
  onDismiss,
}: {
  event: DocumentRunEvent | null;
  onDismiss: () => void;
}) {
  if (!event) {
    return null;
  }

  const label =
    event.type === "document.run.completed"
      ? "Processing completed"
      : event.type === "document.run.failed"
        ? "Processing failed"
        : `Status updated to ${event.status}`;

  return (
    <div className="toast" role="status">
      <div>{label}</div>
      {event.failureMessage ? (
        <div className="muted" style={{ color: "#d7ece9", marginTop: "0.35rem" }}>
          {event.failureMessage}
        </div>
      ) : null}
      <button
        className="button secondary"
        style={{ marginTop: "0.75rem" }}
        onClick={onDismiss}
        type="button"
      >
        Dismiss
      </button>
    </div>
  );
}
