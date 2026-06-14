import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  createSession,
  getAuthenticatedUserFromToken,
  revokeSession,
} from "@/server/auth/session";

beforeEach(async () => {
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();
});

describe("session auth", () => {
  it("creates and restores a cookie-backed session", async () => {
    const user = await prisma.user.create({
      data: {
        googleSub: "google-session",
        email: "session@example.com",
      },
    });

    const session = await createSession(user.id);
    const restored = await getAuthenticatedUserFromToken(session.token);

    expect(restored?.id).toBe(user.id);
    expect(restored?.email).toBe("session@example.com");
  });

  it("revokes a session on logout", async () => {
    const user = await prisma.user.create({
      data: {
        googleSub: "google-logout",
        email: "logout@example.com",
      },
    });

    const session = await createSession(user.id);
    await revokeSession(session.token);

    const restored = await getAuthenticatedUserFromToken(session.token);
    expect(restored).toBeNull();
  });
});
