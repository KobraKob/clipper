import type { TitleVariant } from "./types";

/**
 * Normalize generated or legacy title variants before they become React keys
 * or API selection IDs. Duplicate IDs are renamed deterministically.
 */
export function normalizeTitleVariants(value: unknown): TitleVariant[] {
  if (!Array.isArray(value)) return [];

  const used = new Set<string>();
  const variants: TitleVariant[] = [];

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const candidate = entry as Partial<TitleVariant>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    if (!title) return;

    const requestedId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const baseId = requestedId || `variant_${index + 1}`;
    let id = baseId;

    if (used.has(id)) {
      id = `variant_${index + 1}`;
      let suffix = 2;
      while (used.has(id)) {
        id = `variant_${index + 1}_${suffix}`;
        suffix += 1;
      }
    }

    used.add(id);
    variants.push({
      id,
      title,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
      ...(typeof candidate.angle === "string" ? { angle: candidate.angle } : {}),
    });
  });

  return variants;
}
