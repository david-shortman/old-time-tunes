import type { OTTNote } from '@ot-tunes/notes';

export const INSTRUMENTS = [
  'fiddle',
  'banjo',
  'mandolin',
  'guitar',
  'voice',
  'other',
] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

/** Common fiddle tunings, lowest string first. */
export const FIDDLE_TUNINGS = [
  'GDAE (standard)',
  'AEAE (cross A)',
  'ADAE',
  'GDAD (sawmill)',
  'AEAC# (calico)',
  'DDAD (dead man)',
] as const;

/** The grid the editor was using when the tune was saved, so bar lines don't move between sessions. */
export type SavedGrid = { bpm: number; offset: number; key: string };

/** Everything the library knows about one recorded variant of a tune. */
export type TuneRecord = {
  id: string;
  title: string;
  /** other names the tune goes by */
  aka: string[];
  instrument: Instrument;
  /** e.g. "D major" */
  key: string;
  tuning?: string;
  performer?: string;
  /** where it came from: "me, kitchen, Oct 2026" or "Henry Reed, Library of Congress 1967" */
  source?: string;
  tags: string[];
  /** free text: what to watch for, which part is hard, etc. */
  notes?: string;
  durationSeconds: number;
  noteCount: number;
  audio: { fileName: string; mimeType: string; bytes: number };
  transcription: OTTNote[];
  grid?: SavedGrid;
  createdAt: string;
  updatedAt: string;
};

/** What a list view needs; the transcription itself is loaded on demand. */
export type TuneSummary = Omit<TuneRecord, 'transcription'>;

export type NewTune = Omit<
  TuneRecord,
  'id' | 'createdAt' | 'updatedAt' | 'noteCount' | 'audio'
> & { audio: Blob; fileName: string };
