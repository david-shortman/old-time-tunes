# Transcription evaluation harness

Scores audio-to-notes transcription against known ground truth so model and
post-processing changes can be compared by number instead of by ear.

## Inputs (`eval/tunes/`)

- `*.abc` — melody-only ABC notation of beginner fiddle tunes (from thesession.org).
  Rendered to MIDI with `abc2midi` and to a 44.1 kHz WAV with `fluidsynth` using
  the General MIDI violin program, so the ground truth is exact.
- `*.wav` / `*.mp3` — real recordings. Scored if a sibling `.mid` exists, otherwise
  just transcribed and printed with `--show N`.

Rendered files land in `eval/out/` (git-ignored).

## Setup

```bash
brew install abcmidi fluid-synth
poetry install
```

## Run (from `apps/ott-bp-api`)

```bash
poetry run python eval/run_eval.py                 # API's current default settings
poetry run python eval/run_eval.py --mono          # one-note-at-a-time post-processing
poetry run python eval/run_eval.py --mono --show 30  # expected vs got, note by note
poetry run python eval/run_eval.py --tunes eval/real --show 40   # real recordings
```

Metrics are `mir_eval` note-level precision / recall / F1 with a 50 ms onset
tolerance and 50-cent pitch tolerance. `F1+off` additionally requires the
note's end to be within 20% of the reference duration.

## Results so far (synthetic violin, 6 tunes, 2026-10-06)

| Setting                                | mean F1 | F1+off (range) |
| -------------------------------------- | ------- | -------------- |
| Basic Pitch defaults (what the API does) | 0.959   | 0.23 – 0.63    |
| + fiddle range 190–2800 Hz             | 0.959   | unchanged      |
| frame threshold 0.15                   | 0.624   | 0.07 – 0.25    |
| **+ `--mono`**                         | **0.985** | **0.94 – 0.99** |
| + `--mono --legato`                    | 0.985   | unchanged      |

Takeaways:

- Basic Pitch already finds the right pitch at the right onset on clean solo
  fiddle audio. The remaining errors were (a) low-amplitude harmonic ghosts
  (an octave or twelfth above the real note) and (b) note ends bleeding into
  the next note, which wrecked durations.
- `enforce_monophonic` fixes both: a new onset always ends the current note,
  and a note that starts while a much louder one is sounding is dropped.
- Restricting the frequency range did nothing here, but should still help on
  noisy real recordings (room rumble, guitar accompaniment).
- Lowering the frame threshold is not a fix for anything.

The monophonic rule now lives in `ott_bp_api/postprocess.py` and is on by default in the API
(`?monophonic=false` turns it off). Next: real recordings in `eval/real/`.

## Real recording: Henry Reed, Soldier's Joy (LOC, 1967) — 2026-10-07

72 s field recording, 16 kHz mono MP3, no ground truth. See `eval/real/README.md`.

- Tuning sits +26 cents above A440 (librosa estimate), so snapping to the
  nearest semitone is safe. Re-snapping with the offset made the pitch-class
  histogram *worse*, so leave pitches as the model reports them.
- F-natural and G-sharp show up in a D tune. Among longer notes only ~10% are
  off-scale; that is consistent with old-time neutral-third intonation, not a
  model error. Expect this on real fiddle audio and don't "fix" it.
- Minimum note length is the big lever on real audio: 58 ms (API) gives ~400
  notes, Basic Pitch's default 128 ms gives ~205. On clean synthetic audio
  128 ms is marginally better (F1 0.987 vs 0.985), but sixteenth notes at
  120 BPM are 125 ms, so 128 ms will swallow fast runs. Decide by ear:
  `eval/out/henry-reed-{58ms,128ms}.compare.mp3` has the original in the left
  ear and the synthesized transcription in the right.
- The frequency restriction (190–2800 Hz) removed one note. Harmless; keep it
  for noisy input.
