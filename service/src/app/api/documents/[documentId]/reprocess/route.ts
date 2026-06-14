import { getAuthenticatedUser } from "@/server/auth/session";
import { reprocessDocument } from "@/server/documents/documentService";
import {
  jsonResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/server/http";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { documentId } = await context.params;
  const document = await reprocessDocument({
    userId: user.id,
    documentId,
  });

  if (!document) {
    return notFoundResponse();
  }

  return jsonResponse(document, { status: 201 });
}
