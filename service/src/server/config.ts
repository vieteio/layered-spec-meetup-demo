export const config = {
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    "http://localhost:3000/api/auth/google/callback",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret",
  sessionCookieName: "session",
  sessionMaxAgeSeconds: 60 * 60 * 24 * 30,
  lastSeenThrottleMs: 60_000,
  pdfStorageRoot: process.env.PDF_STORAGE_ROOT ?? "./storage/pdfs",
  maxPdfSizeMb: Number(process.env.MAX_PDF_SIZE_MB ?? "32"),
  parsePageBatchSize: Number(process.env.PARSE_PAGE_BATCH_SIZE ?? "10"),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  llmMock: process.env.LLM_MOCK === "true" || !process.env.OPENAI_API_KEY,
  parseModel: process.env.PARSE_MODEL ?? "gpt-4o-mini",
  estimationModel: process.env.ESTIMATION_MODEL ?? "gpt-4o-mini",
};

export const MAX_PDF_SIZE_BYTES = config.maxPdfSizeMb * 1024 * 1024;
