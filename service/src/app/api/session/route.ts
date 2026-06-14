import { getAuthenticatedUser } from "@/server/auth/session";
import { jsonResponse, unauthorizedResponse } from "@/server/http";

export async function GET(): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  return jsonResponse({ user });
}
