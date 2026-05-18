import test from "node:test";
import assert from "node:assert/strict";

// BUG-39 (D 2026-05-18 GAIA bench full-run EMPTY 50%): web_search MCP
// tool degraded to textError "not configured" when WEB_SEARCH_API_KEY
// was absent, blanking every GAIA / research turn. Pedro mandate
// "mande o claude usar web search porra, ou duck duck go" - add DDG
// html-scrape fallback so the tool works without a key.
//
// These tests pin the DDG parser shape against a captured DDG html
// fragment. Network call itself is integration-tested via the live
// runtime path; here we isolate the regex extraction so a DDG html
// schema change is caught at unit-test time.

const DDG_FIXTURE = `
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FMichio_Sugeno&amp;rut=abc">
      Michio Sugeno - Wikipedia
    </a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FMichio_Sugeno">
    Japanese researcher, recipient of IEEE Frank Rosenblatt Award in 2010.
  </a>
</div>
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.ieee.org%2Fawards%2Frosenblatt">
      IEEE Frank Rosenblatt Award recipients
    </a>
  </h2>
  <a class="result__snippet">2010 recipient: Michio Sugeno for contributions to fuzzy logic.</a>
</div>
`;

const MAX_SNIPPET = 400;
const FETCH_RESULTS = 8;

function parseDdg(html: string) {
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && results.length < FETCH_RESULTS) {
    const hrefRaw = m[1] ?? "";
    let realUrl = hrefRaw;
    const uddg = hrefRaw.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        realUrl = decodeURIComponent(uddg[1]);
      } catch {
        // keep raw
      }
    }
    const stripTags = (s: string): string =>
      s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const title = stripTags(m[2] ?? "");
    const snippet = stripTags(m[3] ?? "").slice(0, MAX_SNIPPET);
    if (realUrl) results.push({ title, url: realUrl, snippet });
  }
  return results;
}

test("DDG parser extracts 2 results from fixture", () => {
  const r = parseDdg(DDG_FIXTURE);
  assert.equal(r.length, 2);
});

test("DDG parser decodes uddg-wrapped real URLs", () => {
  const r = parseDdg(DDG_FIXTURE);
  assert.equal(r[0].url, "https://en.wikipedia.org/wiki/Michio_Sugeno");
  assert.equal(r[1].url, "https://www.ieee.org/awards/rosenblatt");
});

test("DDG parser strips html + collapses whitespace in titles", () => {
  const r = parseDdg(DDG_FIXTURE);
  assert.equal(r[0].title, "Michio Sugeno - Wikipedia");
  assert.equal(r[1].title, "IEEE Frank Rosenblatt Award recipients");
});

test("DDG parser extracts snippets", () => {
  const r = parseDdg(DDG_FIXTURE);
  assert.match(r[0].snippet, /Frank Rosenblatt Award in 2010/);
  assert.match(r[1].snippet, /Michio Sugeno/);
});

test("DDG parser skips unknown href if no uddg param", () => {
  const fixture = `
    <a class="result__a" href="https://no-redirect-direct.example.com">Direct link</a>
    <a class="result__snippet">snippet</a>
  `;
  const r = parseDdg(fixture);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, "https://no-redirect-direct.example.com");
});

test("DDG parser caps results at FETCH_RESULTS", () => {
  let large = "";
  for (let i = 0; i < 15; i++) {
    large += `
      <a class="result__a" href="//d.co/?uddg=https%3A%2F%2Fex${i}.com">title${i}</a>
      <a class="result__snippet">snip${i}</a>
    `;
  }
  const r = parseDdg(large);
  assert.equal(r.length, FETCH_RESULTS);
});
