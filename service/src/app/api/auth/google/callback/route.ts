import { NextRequest, NextResponse } from "next/server";
import { config } from "@/server/config";
import {
  consumeOAuthState,
  exchangeGoogleCode,
  upsertUserFromGoogleProfile,
} from "@/server/auth/google";
import {
  buildSessionCookie,
  createSession,
} from "@/server/auth/session";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(`${config.appBaseUrl}/?error=oauth_missing`);
  }

  const stateValid = await consumeOAuthState(state);
  if (!stateValid) {
    return NextResponse.redirect(`${config.appBaseUrl}/?error=oauth_state`);
  }

  try {
    const profile = await exchangeGoogleCode(code);
    const user = await upsertUserFromGoogleProfile(profile);
    const session = await createSession(user.id);

    const response = NextResponse.redirect(`${config.appBaseUrl}/documents`);
    response.headers.set(
      "Set-Cookie",
      buildSessionCookie(session.token, session.expiresAt),
    );
    return response;
  } catch {
    return NextResponse.redirect(`${config.appBaseUrl}/?error=oauth_failed`);
  }
}
