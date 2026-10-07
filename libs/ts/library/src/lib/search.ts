import type { TuneSummary } from './types';

export type LibraryFilter = {
  query?: string;
  instrument?: string;
  key?: string;
};

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Score a tune against free text: title and aka first, then performer, tags, source, notes. */
export function scoreTune(t: TuneSummary, query: string): number {
  const q = norm(query.trim());
  if (!q) return 1;
  const words = q.split(/\s+/);
  let score = 0;
  for (const w of words) {
    if (norm(t.title).includes(w))
      score += norm(t.title).startsWith(w) ? 10 : 6;
    if (t.aka.some((a) => norm(a).includes(w))) score += 5;
    if (t.performer && norm(t.performer).includes(w)) score += 3;
    if (t.tags.some((g) => norm(g).includes(w))) score += 3;
    if (norm(t.key).includes(w) || norm(t.instrument).includes(w)) score += 2;
    if (t.source && norm(t.source).includes(w)) score += 1;
    if (t.notes && norm(t.notes).includes(w)) score += 1;
  }
  return score;
}

/** Filter and rank; falls back to most recently updated when there is no query. */
export function searchTunes(
  tunes: TuneSummary[],
  f: LibraryFilter
): TuneSummary[] {
  return tunes
    .filter(
      (t) =>
        (!f.instrument || t.instrument === f.instrument) &&
        (!f.key || t.key === f.key)
    )
    .map((t) => ({ t, s: scoreTune(t, f.query ?? '') }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || b.t.updatedAt.localeCompare(a.t.updatedAt))
    .map(({ t }) => t);
}
