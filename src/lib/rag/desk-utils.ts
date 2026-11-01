import type { SourceDoc } from "./types.ts";

export type DocSortMode = "recent" | "title" | "passages";

export function filterAndSortDocs(
  docs: readonly SourceDoc[],
  query: string,
  sortMode: DocSortMode = "recent",
  passageCounts: Map<string, number> = new Map(),
): SourceDoc[] {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? docs.filter((doc) => {
        const haystack = [
          doc.title,
          doc.short,
          doc.filename,
          doc.kicker,
          doc.dateLabel,
          doc.note,
          doc.text,
          doc.id,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      })
    : [...docs];

  const sorted = [...filtered];
  sorted.sort((left, right) => {
    if (sortMode === "title") {
      return left.short.localeCompare(right.short) || left.title.localeCompare(right.title);
    }

    if (sortMode === "passages") {
      const leftCount = passageCounts.get(left.id) ?? 0;
      const rightCount = passageCounts.get(right.id) ?? 0;
      return rightCount - leftCount || right.addedAt - left.addedAt;
    }

    return right.addedAt - left.addedAt || left.short.localeCompare(right.short);
  });

  return sorted;
}
