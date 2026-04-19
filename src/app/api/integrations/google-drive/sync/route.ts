import { NextResponse } from "next/server";
import { syncDrive } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function POST() {
  try {
    const summary = await syncDrive({ maxFiles: 100 });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
