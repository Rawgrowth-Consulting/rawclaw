/**
 * Runtime env-var validation. Fails fast at server boot when a required
 * variable is missing so we get a loud error instead of a mysterious 500
 * from some route down the line.
 *
 * Usage: import the pre-computed `env` object anywhere in the app. It
 * throws synchronously on first access if a hard requirement is missing.
 * Optional vars simply return undefined.
 *
 * The check runs once per process (module cache) so it's cheap.
 */

type RequiredFor = "hosted" | "self_hosted" | "v3" | "all";

const DEPLOY_MODE =
  (process.env.DEPLOY_MODE as "hosted" | "self_hosted" | "v3" | undefined) ??
  "hosted";

type Spec = {
  key: string;
  required: RequiredFor;
  /** Soft-required: missing just emits a warn (used for optional services). */
  soft?: boolean;
};

const SPECS: Spec[] = [
  { key: "DATABASE_URL", required: "all" },
  { key: "NEXT_PUBLIC_SUPABASE_URL", required: "all" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", required: "all" },
  { key: "NEXTAUTH_URL", required: "all" },
  { key: "NEXTAUTH_SECRET", required: "all" },
  { key: "JWT_SECRET", required: "all" },

  // v3-specific: onboarding chat + embeddings.
  { key: "OPENAI_API_KEY", required: "v3", soft: true },
  // Path B runtime + voice Path A. Soft because the default is CLI.
  { key: "ANTHROPIC_API_KEY", required: "v3", soft: true },

  // Optional integrations.
  { key: "NANGO_SECRET_KEY", required: "all", soft: true },
  { key: "RESEND_API_KEY", required: "all", soft: true },
  { key: "CRON_SECRET", required: "all", soft: true },
];

function appliesTo(required: RequiredFor): boolean {
  return required === "all" || required === DEPLOY_MODE;
}

const missing: string[] = [];
const softMissing: string[] = [];

for (const spec of SPECS) {
  if (!appliesTo(spec.required)) continue;
  if (!process.env[spec.key]) {
    (spec.soft ? softMissing : missing).push(spec.key);
  }
}

// Don't explode in dev where half the vars are absent. Next dev boots
// routes lazily and hitting a route without the var still surfaces a
// clear error from the route itself. Production fails loud.
const shouldThrow = process.env.NODE_ENV === "production" && missing.length > 0;

if (missing.length > 0) {
  const msg =
    `[env] Missing required variables for DEPLOY_MODE=${DEPLOY_MODE}: ${missing.join(", ")}. ` +
    `Copy .env.v3.example to .env and fill them in.`;
  if (shouldThrow) throw new Error(msg);
  else console.warn(msg);
}

if (softMissing.length > 0 && process.env.NODE_ENV !== "test") {
  console.info(
    `[env] Soft-missing (features will be disabled): ${softMissing.join(", ")}`,
  );
}

export const env = {
  DEPLOY_MODE,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  JWT_SECRET: process.env.JWT_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  NANGO_SECRET_KEY: process.env.NANGO_SECRET_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
} as const;
