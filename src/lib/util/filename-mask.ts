/**
 * Filename indirection helpers. Used by the agent-files context
 * block so the model sees opaque `[N]` indices instead of raw
 * filenames in its prompt - prevents the operator's actual file
 * names from leaking into reasoning chips, tool-call arg strings,
 * or chat history that gets persisted then read back next turn
 * (the same class of bug HOTFIX 30 fixed for humanized text).
 *
 * maskFilenames(files) → "[1], [2], [3]"
 * unmaskIndex("[2]", files) → files[1].name
 *
 * Helper is intentionally tiny and side-effect-free so any
 * consumer (preamble builder, tool wrapper, render layer) can
 * import it without dragging in supabase.
 */

export type MaskedFile = { name: string };

export function maskFilenames(files: ReadonlyArray<MaskedFile>): string {
  return files.map((_, i) => `[${i + 1}]`).join(", ");
}

export function unmaskIndex(
  idx: string,
  files: ReadonlyArray<MaskedFile>,
): string | null {
  const m = idx.match(/^\[(\d+)\]$/);
  if (!m) return null;
  const i = Number.parseInt(m[1], 10) - 1;
  if (i < 0 || i >= files.length) return null;
  return files[i].name;
}
