import { randomBytes } from "node:crypto";
import { config } from "@/server/config";
import { prisma } from "@/server/db/prisma";
import type { AuthenticatedUser } from "@/server/auth/session";
import { toAuthenticatedUser } from "@/server/auth/session";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleProfile = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

/** Implements: redirect the browser into Google OAuth. */
export async function createGoogleAuthRedirectUrl(): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.oAuthState.create({
    data: { state, expiresAt },
  });

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function consumeOAuthState(state: string): Promise<boolean> {
  const record = await prisma.oAuthState.findUnique({ where: { state } });
  if (!record || record.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  await prisma.oAuthState.delete({ where: { id: record.id } });
  return true;
}

/** Implements: exchange Google authorization code and fetch profile. */
export async function exchangeGoogleCode(
  code: string,
): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: config.googleRedirectUri,
    grant_type: "authorization_code",
  });

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenResponse.ok) {
    throw new Error("Failed to exchange Google authorization code");
  }

  const tokenData = (await tokenResponse.json()) as { access_token: string };
  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileResponse.ok) {
    throw new Error("Failed to fetch Google user profile");
  }

  return (await profileResponse.json()) as GoogleProfile;
}

export async function upsertUserFromGoogleProfile(
  profile: GoogleProfile,
): Promise<AuthenticatedUser> {
  const user = await prisma.user.upsert({
    where: { googleSub: profile.sub },
    create: {
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    },
    update: {
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    },
  });

  return toAuthenticatedUser(user);
}
