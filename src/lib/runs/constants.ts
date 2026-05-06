export const RUN_STATUSES = [
  "pending",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
