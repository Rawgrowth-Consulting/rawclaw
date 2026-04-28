/**
 * Shared SWR fetcher. Every hook that reads from our own `/api/*`
 * endpoints should use this so error handling + JSON parsing is
 * consistent.
 *
 * Auth-redirect handling: when the proxy intercepts an unauthenticated
 * request to /api/* it returns a 307 to /auth/signin. Browser fetch
 * follows the redirect by default, lands on the HTML signin page (200
 * OK), and `res.json()` then throws a SyntaxError that surfaces in the
 * UI as a confusing perma-load. We detect that case explicitly and hard
 * navigate to the signin page so the user can recover instead of
 * staring at a stuck spinner.
 */

export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);

  // Followed-redirect to the signin page. Hard-nav so the user actually
  // sees the login form instead of a perma-spinner.
  if (res.redirected && res.url.includes("/auth/signin")) {
    if (typeof window !== "undefined") {
      window.location.href = res.url;
    }
    throw new Error("Not signed in");
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  // Defensive: an HTML response on a JSON endpoint usually means the
  // request landed on a signin/error page after a redirect we couldn't
  // detect. Surface a clear error instead of letting `res.json()` throw
  // a cryptic SyntaxError.
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(`Unexpected response (${ct || "no content-type"})`);
  }

  return (await res.json()) as T;
}
