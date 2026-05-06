// Copy Pedro's local Claude Code OAuth token (~/.claude/.credentials.json)
// into the Pedro Onboard Test org's rgaios_connections row, encrypted with
// the cloud JWT_SECRET. After this, the test account's onboarding chat
// runs against Pedro's actual Claude Max session.
//
// Loads cloud env from .env.cloud (vercel env pull --environment production)
// so encrypt/decrypt match what the deployed worker will see.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import pg from "pg";

// .env.cloud has JWT_SECRET="value" (quoted). Strip quotes.
const cloudEnv = Object.fromEntries(
  readFileSync(
    "/home/pedroafonso/rawclaw-research/rawclaw/.env.cloud",
    "utf8",
  )
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const m = l.match(/^([^=]+)="?(.*?)"?$/);
      return m ? [m[1], m[2]] : null;
    })
    .filter(Boolean),
);

const JWT_SECRET = cloudEnv.JWT_SECRET;
const DATABASE_URL = cloudEnv.DATABASE_URL;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing from .env.cloud");
if (!DATABASE_URL) throw new Error("DATABASE_URL missing from .env.cloud");

const TEST_ORG_ID = "7154f299-af35-4b14-9e42-ff9f41319694";

function encryptSecret(plaintext) {
  const key = createHash("sha256")
    .update(`rawgrowth:secret-at-rest:v1:${JWT_SECRET}`)
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    "enc:v1:" + Buffer.concat([iv, tag, ciphertext]).toString("base64url")
  );
}

const creds = JSON.parse(
  readFileSync("/home/pedroafonso/.claude/.credentials.json", "utf8"),
);
const oauth = creds.claudeAiOauth;
if (!oauth?.accessToken) throw new Error("no accessToken in .credentials.json");

const access = encryptSecret(oauth.accessToken);
const refresh = oauth.refreshToken ? encryptSecret(oauth.refreshToken) : "";

const c = new pg.Client({ connectionString: DATABASE_URL });
await c.connect();

const installedAt = new Date().toISOString();
const metadata = {
  access_token: access,
  refresh_token: refresh,
  expires_in: oauth.expiresAt
    ? Math.max(0, Math.floor((oauth.expiresAt - Date.now()) / 1000))
    : null,
  installed_at: installedAt,
  source: "pedro_local_credentials_copy",
};

const existing = await c.query(
  `select id from rgaios_connections
    where organization_id = $1 and provider_config_key = 'claude-max'`,
  [TEST_ORG_ID],
);

if (existing.rowCount > 0) {
  await c.query(
    `update rgaios_connections
        set metadata = $1, updated_at = now()
      where organization_id = $2 and provider_config_key = 'claude-max'`,
    [metadata, TEST_ORG_ID],
  );
  console.log("✓ updated existing claude-max row for test org");
} else {
  await c.query(
    `insert into rgaios_connections
       (id, organization_id, provider_config_key, nango_connection_id,
        display_name, metadata, created_at, updated_at)
     values (gen_random_uuid(), $1, 'claude-max', $2, 'Claude Max', $3, now(), now())`,
    [TEST_ORG_ID, `claude-max:${TEST_ORG_ID}`, metadata],
  );
  console.log("✓ inserted new claude-max row for test org");
}

console.log("token len:", oauth.accessToken.length);
console.log("expires at:", oauth.expiresAt ? new Date(oauth.expiresAt).toISOString() : "n/a");

await c.end();
