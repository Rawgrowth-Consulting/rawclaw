import { randomBytes } from "node:crypto";

export function newManageToken(): string {
  return randomBytes(32).toString("hex");
}

export function isValidTokenShape(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}
