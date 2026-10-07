# Old Time Tunes

An accessible web app for old-time music: upload a recording of a tune, see
every note as it plays — the note name, where it sits on the fingerboard, and
soon tab and staff views — then fix the transcription by hand and share it.
The long-term shape is a library of tunes with variants by instrument and key,
and user-uploaded recordings.

Dev logs: [Old Time Tunes Dev Log](https://dev.to/davidshortman) on dev.to.

## What's here

| project | path | what it is |
| --- | --- | --- |
| `ott-app` | `apps/ott-app` | Next.js app: the library (search, follow along, loop), add a recording (transcribe, tidy notes, describe, save), tune pages with autosaving edits |
| `ott-react-playback` | `libs/react/playback` | React player + timeline editor (fingering, waveform comparison, beat grid, note editing) |
| `ott-notes` | `libs/ts/notes` | the shared `OTTNote` type |
| `ott-library` | `libs/ts/library` | tune data model, storage interface (IndexedDB today), search |
| `ott-transcribe` | `libs/ts/transcribe` | Basic Pitch in the browser via ONNX Runtime Web, same post-processing as the API |
| `ott-bp-api` | `apps/ott-bp-api` | FastAPI service wrapping Spotify's Basic Pitch, with fiddle-oriented post-processing, plus an evaluation harness in `eval/` |

Transcription runs in the browser by default (ONNX Runtime Web, no server) after an
explicit one-time ~14 MB download that the page asks for and tracks;
the Python API remains as the reference implementation and the evaluation
harness (see `apps/ott-bp-api/eval/README.md` for what the model does well
and badly). The upload form has a switch between the two.

## Running it

Python side (once):

```bash
pipx install poetry
brew install abcmidi fluid-synth   # only for the eval harness
cd apps/ott-bp-api && poetry install
```

Then two terminals:

```bash
npx nx serve ott-bp-api     # FastAPI on :8000 (optional: only for the "server" engine and the eval harness)
```

```bash
npx nx serve ott-app        # Next.js on :4200 (production is a static export, see Firebase below)
```

Open http://localhost:4200. The library starts empty; add a recording of yourself
or the bundled Henry Reed "Soldier's Joy" sample (Library of Congress). The
library is stored in the browser (IndexedDB) for now, so it lives on one device.

## Checks

```bash
npx nx run-many -t lint test
```

```bash
cd apps/ott-bp-api && poetry run pytest
```

Transcription quality against ground truth:

```bash
cd apps/ott-bp-api && poetry run python eval/run_eval.py --mono
```

## Firebase (shared library, in progress)

Decisions: static export to Firebase Hosting, email magic-link sign-in,
public/private visibility. Plan: [docs/firebase-plan.md](docs/firebase-plan.md).

Config in the repo: `firebase.json` (hosting from `apps/ott-app/out`, cache and
cross-origin-isolation headers, emulators), `firestore.rules`,
`firestore.indexes.json`, `storage.rules`, `.firebaserc` (project
`old-time-tunes`). The web app reads `NEXT_PUBLIC_FIREBASE_*` from
`apps/ott-app/.env.local`; copy `.env.local.example` and fill it from the
Firebase console or `firebase apps:sdkconfig web`. Without it the app runs
browser-only.

```bash
npx nx run ott-app:emulators      # Auth, Firestore, Storage, Hosting emulators (+ UI on :4000)
```

```bash
npx nx run ott-app:deploy-preview # static export + Hosting preview channel (needs `firebase login`)
```

```bash
npx nx run ott-app:deploy         # static export + deploy hosting, rules and indexes
```

## Layout notes

Nx workspace. `pyproject.toml` lives at the repo root (Poetry resolves upward
from `apps/ott-bp-api`). Python is pinned to 3.10 because Basic Pitch 0.4 and
TensorFlow 2.15 for macOS require it.
