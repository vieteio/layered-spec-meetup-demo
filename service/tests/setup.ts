import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

process.env.DATABASE_URL = "file:./test.db";
process.env.LLM_MOCK = "true";
process.env.SESSION_SECRET = "test-session-secret";
process.env.PDF_STORAGE_ROOT = "./storage/test-pdfs";

rmSync("test.db", { force: true });

execSync("npx prisma db push", {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});
