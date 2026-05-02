/**
 * Cloudflare DNS automation. When per-tenant provisioning creates a
 * droplet, this module adds the A record so the cloud-init Caddy can
 * issue TLS certs on first boot without manual DNS setup.
 *
 * Auth: CLOUDFLARE_API_TOKEN env var (zone:edit scope on the
 * PROVISION_BASE_DOMAIN zone).
 *
 * Skipped silently when CLOUDFLARE_API_TOKEN unset - operator manages
 * DNS by hand or via wildcard.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

type Headers = { Authorization: string; "Content-Type": string };

function authHeaders(): Headers | null {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function isCloudflareEnabled(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN);
}

let zoneCache = new Map<string, string>();

async function findZoneId(zoneName: string): Promise<string | null> {
  const cached = zoneCache.get(zoneName);
  if (cached) return cached;
  const headers = authHeaders();
  if (!headers) return null;
  const res = await fetch(
    `${CF_API}/zones?name=${encodeURIComponent(zoneName)}`,
    { headers },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: Array<{ id: string; name: string }>;
  };
  const zone = data.result?.[0];
  if (zone) {
    zoneCache.set(zoneName, zone.id);
    return zone.id;
  }
  return null;
}

/**
 * Upsert an A record. Idempotent: if a record with the same name
 * exists, updates its IP; otherwise creates it. Proxied=false so
 * Caddy can hit the origin directly for ACME challenges.
 */
export async function upsertA(params: {
  fullDomain: string; // e.g. acme-abc123.rawgrowth.app
  ipv4: string;
  zoneApex: string; // e.g. rawgrowth.app
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: "CLOUDFLARE_API_TOKEN not set" };

  const zoneId = await findZoneId(params.zoneApex);
  if (!zoneId) {
    return { ok: false, error: `zone ${params.zoneApex} not found` };
  }

  // Check if record exists
  const listRes = await fetch(
    `${CF_API}/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(params.fullDomain)}`,
    { headers },
  );
  if (!listRes.ok) {
    return { ok: false, error: `list records ${listRes.status}` };
  }
  const listData = (await listRes.json()) as {
    result?: Array<{ id: string; content: string }>;
  };
  const existing = listData.result?.[0];

  if (existing) {
    if (existing.content === params.ipv4) {
      return { ok: true, id: existing.id };
    }
    const upd = await fetch(
      `${CF_API}/zones/${zoneId}/dns_records/${existing.id}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          type: "A",
          name: params.fullDomain,
          content: params.ipv4,
          ttl: 60,
          proxied: false,
        }),
      },
    );
    if (!upd.ok) {
      const text = await upd.text().catch(() => "");
      return { ok: false, error: `update ${upd.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, id: existing.id };
  }

  const create = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "A",
      name: params.fullDomain,
      content: params.ipv4,
      ttl: 60,
      proxied: false,
    }),
  });
  if (!create.ok) {
    const text = await create.text().catch(() => "");
    return { ok: false, error: `create ${create.status}: ${text.slice(0, 200)}` };
  }
  const created = (await create.json()) as { result?: { id: string } };
  return { ok: true, id: created.result?.id ?? "" };
}

export function clearZoneCache(): void {
  zoneCache = new Map();
}
