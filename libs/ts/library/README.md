# @ot-tunes/library

The tune library: data model, a storage interface, and search.

- `TuneRecord` — one recorded variant of a tune: title, aka, instrument, key, tuning,
  performer, source, tags, free-text notes, the transcription (`OTTNote[]`), the
  editor's saved grid (bpm, downbeat offset, key), and a pointer to the audio.
- `TuneRepository` — list / get / getAudio / create / update / remove. The only
  implementation today is `IndexedDbTuneRepository`, so a library lives in one browser.
  A cloud implementation (Firestore + Storage) slots in behind the same interface.
- `searchTunes(tunes, { query, instrument, key })` — client-side filter and ranking:
  title and aka first, then performer, tags, key/instrument, source, notes.
