import {
  IndexedDbTuneRepository,
  type TuneRepository,
} from '@ot-tunes/library';

let repo: TuneRepository | null = null;

/** One repository per page. Swap the implementation here when the library moves to the cloud. */
export function getRepository(): TuneRepository {
  if (!repo) repo = new IndexedDbTuneRepository();
  return repo;
}

export const formatDuration = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const relativeDate = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
};
