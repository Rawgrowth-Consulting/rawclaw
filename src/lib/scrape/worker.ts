import { supabaseAdmin } from "@/lib/supabase/server";
import {
  buildScrapeSources,
  facebookAdsForPage,
  instagramTopPosts,
  youtubeTopVideos,
} from "@/lib/scrape/sources";
import { fetchSource } from "@/lib/scrape/fetcher";
import { isApifyEnabled } from "@/lib/scrape/apify-client";

/**
 * Drains a queued scrape job for an organization. Called from
 * /api/scrape/route.ts (in-process after onboarding submit) and from
 * the systemd schedule-tick cron (D12) as a retry path.
 *
 * Concurrency: sequential per org. We keep it simple  -  the scrape list
 * is <=~6 URLs and the dashboard unlock gate cares about overall
 * completion, not speed.
 *
 * Never throws  -  failures land in rgaios_scrape_snapshots.status.
 */
export async function drainScrapeQueue(organizationId: string): Promise<{
  total: number;
  succeeded: number;
  blocked: number;
  failed: number;
}> {
  const db = supabaseAdmin();

  // Pull the intake to discover fresh sources if none are queued yet.
  const { data: intake } = await db
    .from("rgaios_brand_intakes")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!intake) {
    return { total: 0, succeeded: 0, blocked: 0, failed: 0 };
  }

  // Seed pending rows for any source URL not yet tracked. Idempotent  - 
  // we don't re-seed succeeded/failed rows on re-run.
  const sources = buildScrapeSources(intake);
  const { data: existing } = await db
    .from("rgaios_scrape_snapshots")
    .select("url")
    .eq("organization_id", organizationId);
  const existingUrls = new Set((existing ?? []).map((r) => r.url));
  const toInsert = sources
    .filter((s) => !existingUrls.has(s.url))
    .map((s) => ({
      organization_id: organizationId,
      url: s.url,
      kind: s.kind,
      status: "pending" as const,
    }));
  if (toInsert.length > 0) {
    await db.from("rgaios_scrape_snapshots").insert(toInsert);
  }

  // Claim every pending row and fetch.
  const { data: pending } = await db
    .from("rgaios_scrape_snapshots")
    .select("id, url")
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  const stats = { total: pending?.length ?? 0, succeeded: 0, blocked: 0, failed: 0 };

  for (const row of pending ?? []) {
    await db
      .from("rgaios_scrape_snapshots")
      .update({ status: "running" })
      .eq("id", row.id);

    const result = await fetchSource(row.url);
    if (result.ok) {
      await db
        .from("rgaios_scrape_snapshots")
        .update({
          status: "succeeded",
          title: result.title,
          content: result.content,
          scraped_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", row.id);
      stats.succeeded += 1;
    } else {
      await db
        .from("rgaios_scrape_snapshots")
        .update({
          status: result.blocked ? "blocked" : "failed",
          error: result.error,
          scraped_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (result.blocked) stats.blocked += 1;
      else stats.failed += 1;
    }
  }

  // Plan §13: scrape best-performing Facebook ads via Apify when the
  // intake provided a facebook_page handle. Tagged kind='ads' so the
  // media-buyer agent can cite real ad copy. Token-gated so the rest
  // of the pipeline keeps running on VPSes without an Apify key.
  await drainFacebookAds(organizationId, intake, stats);

  // Plan §8: top-performing YouTube videos + Instagram posts via Apify.
  // Both are token-gated; on a fresh deploy without APIFY_API_TOKEN we
  // log a warn and skip, so the rest of the pipeline keeps shipping.
  await drainYoutubeTop(organizationId, intake, stats);
  await drainInstagramTop(organizationId, intake, stats);

  return stats;
}

async function drainFacebookAds(
  organizationId: string,
  intake: Record<string, unknown>,
  stats: { total: number; succeeded: number; blocked: number; failed: number },
): Promise<void> {
  const social = intake.social_presence as Record<string, unknown> | null;
  const fbPage = social && typeof social.facebook_page === "string" ? social.facebook_page.trim() : "";
  if (!fbPage) return;

  if (!isApifyEnabled()) {
    console.warn(
      "[scrape] facebook_page set but APIFY_API_TOKEN missing  -  skipping FB ads scrape",
    );
    return;
  }

  const db = supabaseAdmin();
  let ads;
  try {
    ads = await facebookAdsForPage(fbPage, 20);
  } catch (err) {
    console.warn(
      `[scrape] facebook ads scrape failed for org=${organizationId}: ${(err as Error)?.message ?? err}`,
    );
    return;
  }
  if (!ads || ads.length === 0) return;

  // Idempotent insert: skip ad URLs already stored for this org.
  const { data: existingAds } = await db
    .from("rgaios_scrape_snapshots")
    .select("url")
    .eq("organization_id", organizationId)
    .eq("kind", "ads");
  const seen = new Set((existingAds ?? []).map((r) => r.url));

  const rows = ads
    .filter((ad) => !seen.has(ad.url))
    .map((ad) => ({
      organization_id: organizationId,
      url: ad.url,
      kind: "ads" as const,
      status: "succeeded" as const,
      title: ad.page_name,
      content: ad.ad_text ?? "",
      scraped_at: new Date().toISOString(),
      metrics: ad.metrics,
      metadata: {
        ad_text: ad.ad_text,
        start_date: ad.start_date,
        end_date: ad.end_date,
        platforms: ad.platforms,
        page_name: ad.page_name,
      },
    }));

  if (rows.length === 0) return;

  const { error } = await db.from("rgaios_scrape_snapshots").insert(rows);
  if (error) {
    console.warn(`[scrape] failed to insert FB ad snapshots: ${error.message}`);
    return;
  }
  stats.total += rows.length;
  stats.succeeded += rows.length;
}

async function drainYoutubeTop(
  organizationId: string,
  intake: Record<string, unknown>,
  stats: { total: number; succeeded: number; blocked: number; failed: number },
): Promise<void> {
  const social = intake.social_presence as Record<string, unknown> | null;
  const yt =
    social && typeof social.youtube === "string" ? social.youtube.trim() : "";
  if (!yt) return;
  if (!isApifyEnabled()) {
    console.warn(
      "[scrape] youtube channel set but APIFY_API_TOKEN missing - skipping YT top scrape",
    );
    return;
  }

  const db = supabaseAdmin();
  let videos;
  try {
    videos = await youtubeTopVideos(yt, 15);
  } catch (err) {
    console.warn(
      `[scrape] youtube top scrape failed for org=${organizationId}: ${(err as Error)?.message ?? err}`,
    );
    return;
  }
  if (!videos || videos.length === 0) return;

  const { data: existing } = await db
    .from("rgaios_scrape_snapshots")
    .select("url")
    .eq("organization_id", organizationId)
    .eq("kind", "yt_top");
  const seen = new Set((existing ?? []).map((r) => r.url));

  const rows = videos
    .filter((v) => !seen.has(v.url))
    .map((v) => ({
      organization_id: organizationId,
      url: v.url,
      kind: "yt_top" as const,
      status: "succeeded" as const,
      title: v.title,
      content: v.title ?? "",
      scraped_at: new Date().toISOString(),
      metrics: v.metrics,
      metadata: {
        view_count: v.view_count,
        like_count: v.like_count,
        comment_count: v.comment_count,
        duration_seconds: v.duration_seconds,
        published_at: v.published_at,
        channel_name: v.channel_name,
      },
    }));

  if (rows.length === 0) return;

  const { error } = await db.from("rgaios_scrape_snapshots").insert(rows);
  if (error) {
    console.warn(`[scrape] failed to insert YT top snapshots: ${error.message}`);
    return;
  }
  stats.total += rows.length;
  stats.succeeded += rows.length;
}

async function drainInstagramTop(
  organizationId: string,
  intake: Record<string, unknown>,
  stats: { total: number; succeeded: number; blocked: number; failed: number },
): Promise<void> {
  const social = intake.social_presence as Record<string, unknown> | null;
  const ig =
    social && typeof social.instagram === "string"
      ? social.instagram.trim()
      : "";
  if (!ig) return;
  if (!isApifyEnabled()) {
    console.warn(
      "[scrape] instagram handle set but APIFY_API_TOKEN missing - skipping IG top scrape",
    );
    return;
  }

  const db = supabaseAdmin();
  let posts;
  try {
    posts = await instagramTopPosts(ig, 20);
  } catch (err) {
    console.warn(
      `[scrape] instagram top scrape failed for org=${organizationId}: ${(err as Error)?.message ?? err}`,
    );
    return;
  }
  if (!posts || posts.length === 0) return;

  const { data: existing } = await db
    .from("rgaios_scrape_snapshots")
    .select("url")
    .eq("organization_id", organizationId)
    .eq("kind", "ig_top");
  const seen = new Set((existing ?? []).map((r) => r.url));

  const rows = posts
    .filter((p) => !seen.has(p.url))
    .map((p) => ({
      organization_id: organizationId,
      url: p.url,
      kind: "ig_top" as const,
      status: "succeeded" as const,
      title: null,
      content: p.caption ?? "",
      scraped_at: new Date().toISOString(),
      metrics: p.metrics,
      metadata: {
        caption: p.caption,
        like_count: p.like_count,
        comment_count: p.comment_count,
        type: p.type,
        posted_at: p.posted_at,
        display_url: p.display_url,
      },
    }));

  if (rows.length === 0) return;

  const { error } = await db.from("rgaios_scrape_snapshots").insert(rows);
  if (error) {
    console.warn(`[scrape] failed to insert IG top snapshots: ${error.message}`);
    return;
  }
  stats.total += rows.length;
  stats.succeeded += rows.length;
}

/**
 * True iff the scrape queue has at least one succeeded/blocked/failed row
 * for this org (i.e. the queue has drained to completion). Blocked + failed
 * are terminal states  -  we do NOT wait for 100% success, only for "we
 * stopped trying". This is what /api/dashboard/gate checks.
 */
export async function isScrapeComplete(organizationId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { count: pendingCount } = await db
    .from("rgaios_scrape_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["pending", "running"]);
  if ((pendingCount ?? 0) > 0) return false;

  const { count: terminalCount } = await db
    .from("rgaios_scrape_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["succeeded", "blocked", "failed"]);
  return (terminalCount ?? 0) > 0;
}
