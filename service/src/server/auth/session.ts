import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { config } from "@/server/config";
import { prisma } from "@/server/db/prisma";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

function hashSessionToken(token: string): string {
  return createHash("sha256")
    .update(`${token}:${config.sessionSecret}`)
    .digest("hex");
}

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

/** Implements: create a new server-backed HTTP cookie session after Google sign-in. */
export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + config.sessionMaxAgeSeconds * 1000,
  );
  const now = new Date();

  await prisma.userSession.create({
    data: {
      userId,
      sessionTokenHash: hashSessionToken(token),
      expiresAt,
      lastSeenAt: now,
    },
  });

  return { token, expiresAt };
}

export function buildSessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  const secure = config.appBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${config.sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function buildClearSessionCookie(): string {
  const secure = config.appBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(config.sessionCookieName)?.value ?? null;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const token = await getSessionTokenFromCookies();
  if (!token) {
    return null;
  }
  return getAuthenticatedUserFromToken(token);
}

export async function getAuthenticatedUserFromToken(
  token: string,
): Promise<AuthenticatedUser | null> {
  const session = await prisma.userSession.findUnique({
    where: { sessionTokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const throttleCutoff = Date.now() - config.lastSeenThrottleMs;
  if (session.lastSeenAt.getTime() < throttleCutoff) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }

  return toAuthenticatedUser(session.user);
}

/** Implements: revoke the current cookie session on logout. */
export async function revokeSession(token: string): Promise<void> {
  await prisma.userSession.deleteMany({
    where: { sessionTokenHash: hashSessionToken(token) },
  });
}
