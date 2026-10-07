import { searchTunes } from './search';
import type { TuneSummary } from './types';

const mk = (over: Partial<TuneSummary>): TuneSummary => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  title: 'Untitled',
  aka: [],
  instrument: 'fiddle',
  key: 'D major',
  tags: [],
  durationSeconds: 60,
  noteCount: 100,
  audio: { fileName: 'x.mp3', mimeType: 'audio/mpeg', bytes: 1 },
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('searchTunes', () => {
  const tunes = [
    mk({
      id: 'sj',
      title: "Soldier's Joy",
      performer: 'Henry Reed',
      tags: ['reel'],
      updatedAt: '2026-10-02T00:00:00Z',
    }),
    mk({
      id: 'ojc',
      title: 'Old Joe Clark',
      key: 'A mixolydian',
      aka: ['Joe Clark'],
    }),
    mk({
      id: 'atb',
      title: 'Angeline the Baker',
      instrument: 'banjo',
      updatedAt: '2026-10-03T00:00:00Z',
    }),
  ];

  it('returns everything, most recently updated first, when there is no query', () => {
    expect(searchTunes(tunes, {}).map((t) => t.id)).toEqual([
      'atb',
      'sj',
      'ojc',
    ]);
  });

  it('matches title, aka and performer, ranking title matches first', () => {
    expect(searchTunes(tunes, { query: 'joe' }).map((t) => t.id)).toEqual([
      'ojc',
    ]);
    expect(searchTunes(tunes, { query: 'reed' }).map((t) => t.id)).toEqual([
      'sj',
    ]);
    expect(searchTunes(tunes, { query: 'soldier' })[0].id).toBe('sj');
  });

  it('filters by instrument and key', () => {
    expect(
      searchTunes(tunes, { instrument: 'banjo' }).map((t) => t.id)
    ).toEqual(['atb']);
    expect(
      searchTunes(tunes, { key: 'A mixolydian' }).map((t) => t.id)
    ).toEqual(['ojc']);
  });

  it('ignores accents and case', () => {
    expect(searchTunes(tunes, { query: 'ANGÉLINE' }).map((t) => t.id)).toEqual([
      'atb',
    ]);
  });
});
