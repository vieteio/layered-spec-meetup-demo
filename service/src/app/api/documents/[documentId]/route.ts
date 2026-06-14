import { getAuthenticatedUser } from "@/server/auth/session";
import {
  deleteTerminalDocument,
  getDocumentDetailForUser,
} from "@/server/documents/documentService";
import {
  badRequestResponse,
  jsonResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/server/http";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { documentId } = await context.params;
  const detail = await getDocumentDetailForUser({
    userId: user.id,
    documentId,
  });

  if (!detail) {
    return notFoundResponse();
  }

  return jsonResponse(detail);
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { documentId } = await context.params;
  const result = await deleteTerminalDocument({
    userId: user.id,
    documentId,
  });

  if (result === "not_found") {
    return notFoundResponse();
  }

  if (result === "active") {
    return badRequestResponse(
      "Only completed or failed documents can be deleted in the first release",
    );
  }

  return jsonResponse({ deleted: true });
}
