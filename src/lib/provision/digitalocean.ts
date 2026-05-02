/**
 * Tiny DigitalOcean API client - just the endpoints we need to spin
 * up a per-tenant droplet for a freshly-paid client. No SDK to keep
 * the bundle small.
 *
 * Auth: DO_API_TOKEN env var (Pedro's account, one token shared
 * across all per-tenant provisions since DO charges per-droplet).
 *
 * Flow:
 *   createDroplet({ name, sshKeyIds, userData })
 *      -> { id, name }
 *   pollUntilActive(id)
 *      -> { id, ip_v4, status }     // polls every 10s for up to 5min
 *
 * cloud-init user_data lets the droplet self-install Docker + clone
 * rawclaw + boot, so no SSH from us is needed.
 */

const DO_API_BASE = "https://api.digitalocean.com/v2";

type Headers = { Authorization: string; "Content-Type": string };

function authHeaders(): Headers | null {
  const token = process.env.DO_API_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function isDigitalOceanEnabled(): boolean {
  return Boolean(process.env.DO_API_TOKEN);
}

type DropletInput = {
  name: string;
  region?: string;
  size?: string;
  image?: string;
  sshKeys?: number[];
  userData?: string;
  tags?: string[];
};

export type DropletStatus = "new" | "active" | "off" | "archive";

export type DropletInfo = {
  id: number;
  name: string;
  status: DropletStatus;
  ipv4: string | null;
};

function extractIp(networks: unknown): string | null {
  if (!networks || typeof networks !== "object") return null;
  const v4 = (networks as { v4?: Array<{ type?: string; ip_address?: string }> }).v4;
  if (!Array.isArray(v4)) return null;
  const pub = v4.find((n) => n.type === "public");
  return pub?.ip_address ?? null;
}

export async function createDroplet(input: DropletInput): Promise<{
  id: number;
  name: string;
}> {
  const headers = authHeaders();
  if (!headers) throw new Error("DO_API_TOKEN not set");

  const body = {
    name: input.name,
    region: input.region ?? "nyc3",
    size: input.size ?? "s-2vcpu-4gb",
    image: input.image ?? "ubuntu-24-04-x64",
    ssh_keys: input.sshKeys ?? [],
    user_data: input.userData,
    tags: input.tags ?? ["rawclaw"],
    monitoring: true,
    ipv6: false,
  };

  const res = await fetch(`${DO_API_BASE}/droplets`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DO createDroplet ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { droplet?: { id: number; name: string } };
  if (!data.droplet) throw new Error("DO createDroplet returned no droplet");
  return { id: data.droplet.id, name: data.droplet.name };
}

export async function getDroplet(id: number): Promise<DropletInfo> {
  const headers = authHeaders();
  if (!headers) throw new Error("DO_API_TOKEN not set");
  const res = await fetch(`${DO_API_BASE}/droplets/${id}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DO getDroplet ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    droplet?: {
      id: number;
      name: string;
      status: DropletStatus;
      networks: unknown;
    };
  };
  if (!data.droplet) throw new Error("DO getDroplet returned no droplet");
  return {
    id: data.droplet.id,
    name: data.droplet.name,
    status: data.droplet.status,
    ipv4: extractIp(data.droplet.networks),
  };
}

/**
 * Poll until droplet is `active` AND has a public IP. Default 5min
 * cap; DO usually flips active in 60-90s. Returns DropletInfo on
 * success, throws on timeout.
 */
export async function pollUntilActive(
  id: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<DropletInfo> {
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000;
  const interval = opts.intervalMs ?? 10_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const info = await getDroplet(id);
    if (info.status === "active" && info.ipv4) return info;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`DO pollUntilActive timeout after ${timeout}ms`);
}

/**
 * Generate a cloud-init user_data script that installs Docker, clones
 * rawclaw, writes the .env from the params, and boots docker compose.
 * Runs as root on first boot before SSH is available - no manual
 * intervention needed.
 *
 * Caller is responsible for filling in: domain, supabase keys, mcp
 * token, anthropic OAuth credentials.
 */
export function buildCloudInit(params: {
  domain: string;
  ownerEmail: string;
  organizationName: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  supabaseAnonKey: string;
  mcpToken: string;
  cronSecret: string;
  nextauthSecret: string;
  encryptionKey: string;
}): string {
  const env = [
    `NEXTAUTH_URL=https://${params.domain}`,
    `NEXTAUTH_SECRET=${params.nextauthSecret}`,
    `DATABASE_URL=${params.supabaseUrl.replace("https://", "postgres://postgres.")}`,
    `NEXT_PUBLIC_SUPABASE_URL=${params.supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${params.supabaseAnonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${params.supabaseServiceKey}`,
    `MCP_TOKEN=${params.mcpToken}`,
    `CRON_SECRET=${params.cronSecret}`,
    `RAWCLAW_ENCRYPTION_KEY=${params.encryptionKey}`,
    `ADMIN_ORG_ID=00000000-0000-0000-0000-000000000001`,
    `DEPLOY_MODE=v3`,
    `RAWCLAW_DRAIN_URL=http://localhost:9876`,
  ].join("\n");

  // Cloud-init script. Runs as root once on first boot.
  return `#cloud-config
package_update: true
package_upgrade: false
packages:
  - docker.io
  - docker-compose-plugin
  - git
  - caddy
write_files:
  - path: /opt/rawclaw/.env
    content: |
      ${env.split("\n").join("\n      ")}
    permissions: "0600"
  - path: /etc/caddy/Caddyfile
    content: |
      ${params.domain} {
        reverse_proxy localhost:3000
      }
    permissions: "0644"
runcmd:
  - systemctl enable --now docker
  - systemctl restart caddy
  - cd /opt/rawclaw && git clone https://github.com/Rawgrowth-Consulting/rawclaw.git . || (cd /opt/rawclaw && git pull)
  - cd /opt/rawclaw && git checkout v3
  - cd /opt/rawclaw && docker compose -f docker-compose.v3.yml up -d
  - echo "PROVISIONED ${params.organizationName} for ${params.ownerEmail}" >> /var/log/rawclaw-provision.log
`;
}
