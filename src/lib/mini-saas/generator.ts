import { chatComplete } from "@/lib/llm/provider";

/**
 * Generate a self-contained single-page web app from a natural-language
 * prompt. Output is one HTML document with inline CSS + JS - no
 * external deps - so the operator can preview it in an iframe sandbox
 * without a build step.
 *
 * Persona is the Engineering Manager + sub-agents (Backend/Frontend/QA
 * Engineer) collapsed into one prompt for v0. Future: route through
 * the actual agent chain so each contributes (FE generates UI, BE
 * generates handlers, QA generates assertions).
 */

const SYSTEM_PROMPT = `You are the Engineering Manager at the user's AI org. Your job: ship a tiny self-contained web app from a one-line description.

Output rules:
- Return ONE complete HTML document, top to bottom: <!doctype html>...</html>.
- All CSS inline in <style>. All JS inline in <script>. No external <link>, no external <script src>, no fetch() to other origins.
- Use plain DOM APIs. No React/Vue/Tailwind/etc.
- Dark theme background (#0A1210), green accent (#0CBF6A), white text. Match Rawgrowth aesthetic.
- Real working interactivity: buttons fire handlers, inputs persist to localStorage, calculations actually compute.
- One screen, no routing.
- Add a small header with the app title + a one-line description.
- Reasonable empty state if there is no data yet.

Output ONLY the HTML. No markdown fences. No commentary. No "here is your app" preamble.`;

export async function generateMiniSaas(prompt: string): Promise<{ html: string }> {
  const res = await chatComplete({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  // Strip accidental markdown fences if the model added them anyway.
  let html = res.text.trim();
  if (html.startsWith("```")) {
    html = html.replace(/^```(?:html)?\s*/, "").replace(/```\s*$/, "");
  }
  if (!html.toLowerCase().includes("<!doctype")) {
    // Fallback wrap so the iframe still renders something instead of
    // a half-broken fragment.
    html = `<!doctype html><html><head><meta charset="utf-8"><title>Mini app</title></head><body>${html}</body></html>`;
  }
  return { html };
}
