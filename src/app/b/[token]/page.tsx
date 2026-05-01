import { ManagePanel } from "./ManagePanel";

export const dynamic = "force-dynamic";

export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-6 font-serif text-3xl tracking-tight">Your booking</h1>
      <ManagePanel token={token} justConfirmed={sp.confirmed === "1"} />
    </div>
  );
}
