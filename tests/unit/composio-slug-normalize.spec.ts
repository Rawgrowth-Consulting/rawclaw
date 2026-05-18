import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogKeyForComposioSlug,
  composioAppNameFor,
} from "../../src/lib/connections/catalog";

// BUG-35 (D 2026-05-18 R-COMPOSIO-3 calendar walk): provider_config_key
// shape diverged between OAuth-start write path (route.ts:136 used
// raw entry.key which can be a live browse Composio slug like
// "googlecalendar") and the executeAction read path (proxy.ts:430
// uses normalizeComposioAppKey which produces the canonical catalog
// key "google-calendar"). Rows existed + status=connected but agent
// got "no connected account for toolkit Google Calendar".
//
// Fix: export catalogKeyForComposioSlug from catalog.ts and use it
// at route.ts:136 so write/read keys agree.

test("catalogKeyForComposioSlug maps Composio slug to catalog key", () => {
  assert.equal(catalogKeyForComposioSlug("googlecalendar"), "google-calendar");
});

test("catalogKeyForComposioSlug is no-op when input is already catalog key", () => {
  assert.equal(catalogKeyForComposioSlug("google-calendar"), "google-calendar");
  assert.equal(catalogKeyForComposioSlug("gmail"), "gmail");
  assert.equal(catalogKeyForComposioSlug("slack"), "slack");
});

test("catalogKeyForComposioSlug returns input unchanged for unknown toolkit", () => {
  assert.equal(catalogKeyForComposioSlug("not-a-known-toolkit"), "not-a-known-toolkit");
});

test("catalogKeyForComposioSlug round-trips with composioAppNameFor", () => {
  // catalog-key -> composio-slug -> catalog-key must be identity
  const catalogKey = "google-calendar";
  const composioSlug = composioAppNameFor(catalogKey);
  assert.equal(composioSlug, "googlecalendar");
  assert.equal(catalogKeyForComposioSlug(composioSlug), catalogKey);
});

test("catalogKeyForComposioSlug handles toolkits with underscore slugs", () => {
  // microsoft-teams catalog key -> microsoft_teams composio slug -> back
  assert.equal(catalogKeyForComposioSlug("microsoft_teams"), "microsoft-teams");
  assert.equal(catalogKeyForComposioSlug("whatsapp_business"), "whatsapp-business");
});
