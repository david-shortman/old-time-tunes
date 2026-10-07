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
| `ott-app` | `apps/ott-app` | Next.js app: upload a recording, view and edit the transcription |
| `ott-react-playback` | `libs/react/playback` | React player + timeline editor (fingering, waveform comparison, beat grid, note editing) |
| `ott-notes` | `libs/ts/notes` | the shared `OTTNote` type |
| `ott-transcribe` | `libs/ts/transcribe` | Basic Pitch in the browser via ONNX Runtime Web, same post-processing as the API |
| `ott-bp-api` | `apps/ott-bp-api` | FastAPI service wrapping Spotify's Basic Pitch, with fiddle-oriented post-processing, plus an evaluation harness in `eval/` |

Transcription runs in the browser by default (ONNX Runtime Web, no server);
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
npx nx serve ott-app        # Next.js on :4200
```

Open http://localhost:4200 and either upload a solo fiddle recording or load
the bundled Henry Reed "Soldier's Joy" sample (Library of Congress).

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

## Layout notes

Nx workspace. `pyproject.toml` lives at the repo root (Poetry resolves upward
from `apps/ott-bp-api`). Python is pinned to 3.10 because Basic Pitch 0.4 and
TensorFlow 2.15 for macOS require it.
