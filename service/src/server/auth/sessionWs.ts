import { createHash } from "node:crypto";
import { config } from "@/server/config";
import { prisma } from "@/server/db/prisma";
import type { AuthenticatedUser } from "@/server/auth/session";
import { toAuthenticatedUser } from "@/server/auth/session";

export function hashSessionTokenForLookup(token: string): string {
  return createHash("sha256")
    .update(`${token}:${config.sessionSecret}`)
    .digest("hex");
}

export async function getAuthenticatedUserFromToken(
  token: string,
): Promise<AuthenticatedUser | null> {
  const session = await prisma.userSession.findUnique({
    where: { sessionTokenHash: hashSessionTokenForLookup(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return toAuthenticatedUser(session.user);
}
