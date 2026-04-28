 
import jwt from "jsonwebtoken";

/**
 * Generate a `service_role` JWT that PostgREST will accept.
 *
 * PostgREST is configured with PGRST_JWT_SECRET (HS256). Any token signed
 * with that secret whose `role` claim matches a Postgres role gets
 * authenticated as that role. Our app passes this JWT in the Authorization
 * header of every request (supabase-js does this automatically when given
 * a service role key).
 *
 * Usage:
 *   npm run self-hosted:jwt -- --secret $JWT_SECRET --role service_role
 *
 * Prints the token to stdout. Drop into SUPABASE_SERVICE_ROLE_KEY in the
 * app's env.
 */

function getArg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i < process.argv.length - 1) return process.argv[i + 1];
  return fallback ?? "";
}

const secret = getArg("--secret", process.env.JWT_SECRET ?? "");
const role = getArg("--role", "service_role");

if (!secret) {
  console.error("--secret (or JWT_SECRET env) is required");
  process.exit(1);
}
if (secret.length < 32) {
  console.error("JWT secret must be at least 32 characters");
  process.exit(1);
}

const token = jwt.sign(
  {
    role,
    iss: "rawgrowth-self-hosted",
    // 10 years — these run inside the server-to-server boundary only.
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10,
  },
  secret,
  { algorithm: "HS256" },
);

process.stdout.write(token + "\n");
