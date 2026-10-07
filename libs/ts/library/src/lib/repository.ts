import type { NewTune, TuneRecord, TuneSummary } from './types';

/** Storage for the tune library. Implemented on IndexedDB today; a cloud store later. */
export interface TuneRepository {
  /** false when this environment has no storage (old browser, private mode, test runner) */
  readonly available: boolean;
  list(): Promise<TuneSummary[]>;
  get(id: string): Promise<TuneRecord | undefined>;
  getAudio(id: string): Promise<Blob | undefined>;
  create(tune: NewTune): Promise<TuneRecord>;
  update(
    id: string,
    patch: Partial<Omit<TuneRecord, 'id' | 'createdAt' | 'audio'>>
  ): Promise<TuneRecord>;
  remove(id: string): Promise<void>;
}
