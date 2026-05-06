import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { NextResponse } from "next/server";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Strict RFC 4122 UUID matcher (any version, hex variant). Used at the
// edge of API routes that take an [id] path param so a non-UUID never
// reaches Postgres and trips an "invalid input syntax for type uuid"
// 500 (which leaks the storage engine + column type).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Returns null when v is a UUID, or a 400 JSON response otherwise.
 * Use at the top of any /api/[id] route:
 *
 *   const bad = badUuidResponse(id);
 *   if (bad) return bad;
 *
 * Centralises the 17 inline copies of the same 3-line guard.
 */
export function badUuidResponse(v: unknown): NextResponse | null {
  if (isUuid(v)) return null;
  return NextResponse.json({ error: "invalid id" }, { status: 400 });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL_RE.test(v);
}
