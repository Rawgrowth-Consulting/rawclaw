import Link from "next/link";

// Portal /portal/[id] is unauthenticated and gated by the queue row id
// being a share-link secret. We render the same generic 404 whether the
// id is malformed or just doesn't exist in the DB so an attacker can't
// distinguish "bad id shape" from "no such row" by probing.
export default function PortalNotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
        <p className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          404
        </p>
        <h1 className="mt-3 font-serif text-3xl tracking-tight text-foreground">
          Portal not found
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          The portal id in this URL doesn&apos;t match any provisioned client.
          Double-check the link from your welcome email, or reach out and
          we will resend it.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
