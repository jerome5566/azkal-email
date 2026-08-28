/* Fails fast at boot rather than at the first request. */
const REQUIRED = ["DATABASE_URL", "SESSION_SECRET"] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}. Copy .env.example to .env.`
    );
  }
  if ((process.env.SESSION_SECRET ?? "").length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
}
