import { getAuthenticatedUser } from "@/server/auth/session";
import { MAX_PDF_SIZE_BYTES } from "@/server/config";
import {
  createDocumentForUpload,
  getDocumentDetailForUser,
  listDocumentsForUser,
} from "@/server/documents/documentService";
import {
  badRequestResponse,
  jsonResponse,
  unauthorizedResponse,
} from "@/server/http";

export async function GET(): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const documents = await listDocumentsForUser(user.id);
  return jsonResponse({ documents });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return badRequestResponse("Exactly one PDF file is required");
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return badRequestResponse("Only PDF uploads are supported");
  }

  if (file.size === 0) {
    return badRequestResponse("Uploaded PDF is empty");
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    return badRequestResponse("Uploaded PDF exceeds the 32 MB limit");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const document = await createDocumentForUpload({
    userId: user.id,
    originalFilename: file.name,
    mimeType: "application/pdf",
    bytes,
  });

  return jsonResponse(document, { status: 201 });
}
