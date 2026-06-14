import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { createGoogleAuthRedirectUrl } from "@/server/auth/google";

export async function GET(): Promise<NextResponse> {
  if (!config.googleClientId || !config.googleClientSecret) {
    return NextResponse.json(
      { error: "Google OAuth is not configured" },
      { status: 503 },
    );
  }

  const redirectUrl = await createGoogleAuthRedirectUrl();
  return NextResponse.redirect(redirectUrl);
}
