import { NextResponse } from "next/server";
import { config } from "@/server/config";
import {
  buildClearSessionCookie,
  getSessionTokenFromCookies,
  revokeSession,
} from "@/server/auth/session";

export async function POST(): Promise<NextResponse> {
  const token = await getSessionTokenFromCookies();
  if (token) {
    await revokeSession(token);
  }

  const response = NextResponse.redirect(`${config.appBaseUrl}/`);
  response.headers.set("Set-Cookie", buildClearSessionCookie());
  return response;
}
