import type { TuneRepository } from './repository';
import type { NewTune, TuneRecord, TuneSummary } from './types';

const DB_NAME = 'ott-library';
const DB_VERSION = 1;
const TUNES = 'tunes';
const AUDIO = 'audio';

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The tune library stored in this browser. Metadata and notes in one store, audio blobs in another. */
export class IndexedDbTuneRepository implements TuneRepository {
  readonly available = typeof indexedDB !== 'undefined';
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.available)
      return Promise.reject(
        new Error('IndexedDB is not available in this browser')
      );
    if (!this.dbPromise) {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(TUNES))
          db.createObjectStore(TUNES, { keyPath: 'id' }).createIndex(
            'updatedAt',
            'updatedAt'
          );
        if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
      };
      this.dbPromise = req(open);
    }
    return this.dbPromise;
  }

  async list(): Promise<TuneSummary[]> {
    const db = await this.db();
    const all = await req(
      db.transaction(TUNES).objectStore(TUNES).getAll() as IDBRequest<
        TuneRecord[]
      >
    );
    return all
      .map((r) => {
        const summary: TuneSummary = { ...r };
        delete (summary as Partial<TuneRecord>).transcription;
        return summary;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<TuneRecord | undefined> {
    const db = await this.db();
    return req(
      db.transaction(TUNES).objectStore(TUNES).get(id) as IDBRequest<
        TuneRecord | undefined
      >
    );
  }

  async getAudio(id: string): Promise<Blob | undefined> {
    const db = await this.db();
    return req(
      db.transaction(AUDIO).objectStore(AUDIO).get(id) as IDBRequest<
        Blob | undefined
      >
    );
  }

  async create(input: NewTune): Promise<TuneRecord> {
    const db = await this.db();
    const now = new Date().toISOString();
    const { audio, fileName, ...rest } = input;
    const record: TuneRecord = {
      ...rest,
      id: newId(),
      noteCount: input.transcription.length,
      audio: {
        fileName,
        mimeType: audio.type || 'application/octet-stream',
        bytes: audio.size,
      },
      createdAt: now,
      updatedAt: now,
    };
    const tx = db.transaction([TUNES, AUDIO], 'readwrite');
    tx.objectStore(TUNES).put(record);
    tx.objectStore(AUDIO).put(audio, record.id);
    await done(tx);
    return record;
  }

  async update(
    id: string,
    patch: Partial<Omit<TuneRecord, 'id' | 'createdAt' | 'audio'>>
  ): Promise<TuneRecord> {
    const db = await this.db();
    const tx = db.transaction(TUNES, 'readwrite');
    const store = tx.objectStore(TUNES);
    const current = await req(
      store.get(id) as IDBRequest<TuneRecord | undefined>
    );
    if (!current) throw new Error(`No tune with id ${id}`);
    const next: TuneRecord = {
      ...current,
      ...patch,
      id,
      createdAt: current.createdAt,
      audio: current.audio,
      updatedAt: new Date().toISOString(),
    };
    if (patch.transcription) next.noteCount = patch.transcription.length;
    store.put(next);
    await done(tx);
    return next;
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([TUNES, AUDIO], 'readwrite');
    tx.objectStore(TUNES).delete(id);
    tx.objectStore(AUDIO).delete(id);
    await done(tx);
  }
}
