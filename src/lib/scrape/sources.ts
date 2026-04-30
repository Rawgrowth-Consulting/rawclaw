import { QUESTIONNAIRE_SECTIONS } from "@/lib/onboarding";
import { runActor } from "@/lib/scrape/apify-client";

/**
 * Build the list of URLs to scrape for a given organization, from the
 * brand intake already filled in during onboarding. Public-source-only
 * to stay inside anti-bot limits:
 *   - Instagram  -> oEmbed endpoint (no login wall)
 *   - LinkedIn   -> /company/<handle>/about (public page)
 *   - YouTube    -> RSS feed (no auth)
 *   - X/Twitter  -> SKIPPED (auth required post-2023)
 *   - Website    -> root HTML
 *
 * Competitors are whatever the client listed in section 9 (competitors).
 * We clip to the first three to keep the scrape bounded.
 */

export type ScrapeSource = {
  kind: "social" | "competitor" | "site";
  url: string;
};

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function socialPresenceToUrls(presence: Record<string, unknown> | null): ScrapeSource[] {
  if (!presence) return [];
  const urls: ScrapeSource[] = [];

  const ig = stringOrNull(presence.instagram);
  if (ig) {
    const handle = ig.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
    urls.push({
      kind: "social",
      url: `https://www.instagram.com/${handle.replace(/\/$/, "")}/`,
    });
  }

  const li = stringOrNull(presence.linkedin);
  if (li) {
    const handle = li.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "").replace(/\/$/, "");
    const isCompany = handle.startsWith("company/") || presence.linkedin_type === "company";
    urls.push({
      kind: "social",
      url: isCompany
        ? `https://www.linkedin.com/${handle}/about/`
        : `https://www.linkedin.com/in/${handle.replace(/^in\//, "")}/`,
    });
  }

  const yt = stringOrNull(presence.youtube);
  if (yt) {
    // Feed URL shape depends on whether we have a channel ID or @handle.
    const handle = yt.replace(/^https?:\/\/(www\.)?youtube\.com\//, "").replace(/\/$/, "");
    if (handle.startsWith("channel/")) {
      urls.push({
        kind: "social",
        url: `https://www.youtube.com/feeds/videos.xml?channel_id=${handle.slice("channel/".length)}`,
      });
    } else if (handle.startsWith("@")) {
      urls.push({
        kind: "social",
        url: `https://www.youtube.com/${handle}/videos`,
      });
    }
  }

  const site = stringOrNull(presence.website);
  if (site) {
    urls.push({ kind: "site", url: site.startsWith("http") ? site : `https://${site}` });
  }

  return urls;
}

function competitorsToUrls(competitors: Record<string, unknown> | null): ScrapeSource[] {
  if (!competitors) return [];
  const list = Array.isArray(competitors.competitor_list)
    ? competitors.competitor_list
    : typeof competitors.competitor_list === "string"
      ? competitors.competitor_list.split(/[,\n]/)
      : [];

  return list
    .slice(0, 3)
    .map((raw: string) => stringOrNull(raw))
    .filter((v: string | null): v is string => !!v)
    .map<ScrapeSource>((c) => ({
      kind: "competitor",
      url: c.startsWith("http") ? c : `https://${c.replace(/^www\./, "")}`,
    }));
}

export function buildScrapeSources(
  intake: Record<string, unknown>,
): ScrapeSource[] {
  const social = intake[
    QUESTIONNAIRE_SECTIONS.find((s) => s.id === "socialPresence")!.column
  ];
  const competitors = intake[
    QUESTIONNAIRE_SECTIONS.find((s) => s.id === "competitors")!.column
  ];
  return [...socialPresenceToUrls(social ?? null), ...competitorsToUrls(competitors ?? null)];
}

/**
 * One ad pulled from Meta Ad Library via apify/facebook-ads-scraper.
 * Shape mirrors the actor's dataset items, with only the fields we
 * persist. The actor returns most-recent first; we tag each row with
 * its position via metrics.recency_rank so the media-buyer agent can
 * sort or filter at query time.
 *
 * Plan §13: triggered when intake captures `facebook_page`. Snapshots
 * land in rgaios_scrape_snapshots tagged kind='ads' (extended in
 * migration 0041).
 */
export type FacebookAd = {
  url: string;
  ad_text: string | null;
  start_date: string | null;
  end_date: string | null;
  platforms: string[];
  page_name: string | null;
  metrics: {
    recency_rank: number;
  };
};

type ApifyFbAdItem = {
  ad_archive_id?: string | number;
  page_name?: string;
  start_date_string?: string;
  end_date_string?: string;
  start_date?: string;
  end_date?: string;
  publisher_platform?: string[] | string;
  snapshot?: {
    body?: { text?: string } | string;
    title?: string;
    cta_text?: string;
  };
  url?: string;
};

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function asPlatforms(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((p): p is string => typeof p === "string");
  if (typeof v === "string") return v.split(",").map((p) => p.trim()).filter(Boolean);
  return [];
}

/**
 * Pull the most recent active ads for a Facebook page via Apify.
 *
 * Apify actor `apify/facebook-ads-scraper` accepts page URLs as input
 * (https://www.facebook.com/<page>) and returns ad library entries with
 * body text + run dates + platforms. Returns ranked results (Apify's
 * own ordering preserved; recency_rank=0 is most recent).
 *
 * Returns [] when APIFY_API_TOKEN is unset so the worker can skip
 * gracefully without erroring.
 */
export async function facebookAdsForPage(
  pageUrl: string,
  limit = 20,
): Promise<FacebookAd[]> {
  const normalized = pageUrl.startsWith("http")
    ? pageUrl
    : `https://www.facebook.com/${pageUrl.replace(/^@/, "").replace(/^facebook\.com\//, "")}`;

  const items = await runActor<ApifyFbAdItem>("apify/facebook-ads-scraper", {
    urls: [{ url: normalized }],
    count: limit,
    "scrapePageAds.activeStatus": "all",
  });
  if (!items) return [];

  return items.slice(0, limit).map<FacebookAd>((item, idx) => {
    const snapBody = item.snapshot?.body;
    const adText =
      typeof snapBody === "string"
        ? snapBody
        : asString(snapBody?.text);
    return {
      url: asString(item.url) ?? `${normalized}#ad-${item.ad_archive_id ?? idx}`,
      ad_text: adText,
      start_date: asString(item.start_date_string) ?? asString(item.start_date),
      end_date: asString(item.end_date_string) ?? asString(item.end_date),
      platforms: asPlatforms(item.publisher_platform),
      page_name: asString(item.page_name),
      metrics: { recency_rank: idx },
    };
  });
}
