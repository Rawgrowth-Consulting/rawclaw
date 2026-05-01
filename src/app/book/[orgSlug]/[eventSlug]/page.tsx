import { BookingClient } from "./BookingClient";

export const dynamic = "force-dynamic";

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  return <BookingClient orgSlug={orgSlug} eventSlug={eventSlug} />;
}
