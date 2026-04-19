import { google } from "googleapis";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, connections } from "@/lib/db/schema";

const REQUIRED_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
] as const;

function readEnv() {
  for (const k of REQUIRED_ENV) {
    if (!process.env[k]) {
      throw new Error(`Missing env: ${k}`);
    }
  }
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
  };
}

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function makeOAuthClient() {
  const { clientId, clientSecret, redirectUri } = readEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function authorizeUrl(state: string): string {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
    state,
  });
}

export type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string;
  email: string | null;
};

export async function exchangeCodeForTokens(code: string): Promise<StoredTokens> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("No access_token in token response");
  }

  client.setCredentials(tokens);
  let email: string | null = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data.email ?? null;
  } catch {
    /* ignore */
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ?? Date.now() + 55 * 60 * 1000,
    scopes: (tokens.scope ?? DRIVE_SCOPES.join(" ")).toString(),
    email,
  };
}

export async function saveDriveConnection(
  integrationId: string,
  t: StoredTokens,
) {
  await db()
    .insert(connections)
    .values({
      integrationId,
      method: "oauth",
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: t.expiresAt,
      scopes: t.scopes,
      accountLabel: t.email,
      connectedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: connections.integrationId,
      set: {
        method: "oauth",
        accessToken: t.accessToken,
        // keep existing refresh token if the new response omitted one
        refreshToken: sql`coalesce(excluded.refresh_token, ${connections.refreshToken})`,
        expiresAt: t.expiresAt,
        scopes: t.scopes,
        accountLabel: t.email,
        connectedAt: Date.now(),
      },
    });

  await logEvent("oauth", { integration: integrationId, account: t.email }, integrationId);
}

export async function loadDriveConnection(integrationId: string) {
  const rows = await db()
    .select()
    .from(connections)
    .where(eq(connections.integrationId, integrationId));
  return rows[0];
}

export async function getAuthedClient(integrationId: string) {
  const stored = await loadDriveConnection(integrationId);
  if (!stored || stored.method !== "oauth") {
    throw new Error(`No OAuth connection for ${integrationId}`);
  }

  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken ?? undefined,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiresAt ?? undefined,
  });

  if (
    stored.expiresAt &&
    stored.expiresAt - Date.now() < 60_000 &&
    stored.refreshToken
  ) {
    const { credentials } = await client.refreshAccessToken();
    if (credentials.access_token) {
      await db()
        .update(connections)
        .set({
          accessToken: credentials.access_token,
          expiresAt: credentials.expiry_date ?? Date.now() + 55 * 60 * 1000,
        })
        .where(eq(connections.integrationId, integrationId));
      client.setCredentials(credentials);
    }
  }

  return client;
}

export async function logEvent(
  kind: string,
  detail: Record<string, unknown> = {},
  integration?: string,
) {
  await db()
    .insert(auditLog)
    .values({ ts: Date.now(), integration, kind, detail });
}
