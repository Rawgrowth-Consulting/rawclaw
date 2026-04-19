/**
 * Shared SWR fetcher. Every hook that reads from our own `/api/*`
 * endpoints should use this so error handling + JSON parsing is
 * consistent.
 */

export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
  return (await res.json()) as T;
}
