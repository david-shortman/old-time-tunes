# @ot-tunes/transcribe

Runs Spotify's Basic Pitch model in the browser with ONNX Runtime Web and turns the
result into `OTTNote[]`, with the same post-processing as the Python API.

```ts
import { transcribeAudio } from '@ot-tunes/transcribe';

const { notes, timing } = await transcribeAudio(
  await file.arrayBuffer(),
  { modelUrl: '/model/nmp.onnx', wasmPaths: '/ort/' },
  { monophonic: true, minNoteLengthMs: 58 },
  (fraction) => setProgress(fraction)
);
```

- `model/nmp.onnx` is the ICASSP 2022 model from the `basic-pitch` Python package
  (Apache-2.0, see `model/NOTICE.md`). Its outputs match the TensorFlow SavedModel
  to ~1e-6.
- `windowing.ts` reproduces `basic_pitch.inference` exactly: 2 s windows of 43,844
  samples at 22.05 kHz, 7,680-sample overlap, 15 frames trimmed each side.
- Note tracking reuses `outputToNotesPoly`, `addPitchBendsToNoteEvents` and
  `noteFramesToTime` from `@spotify/basic-pitch` (its `toMidi` module has no
  TensorFlow dependency). The monophonic rule is a port of `ott_bp_api/postprocess.py`.
- The host app must serve `nmp.onnx` and onnxruntime-web's `.wasm` file; see the
  `copy-assets` target in `apps/ott-app/project.json`.

## Measured (2026-10-07, M-series Mac, Chrome, single WASM thread)

Henry Reed "Soldier's Joy", 72 s MP3, monophonic, 58 ms minimum note:

| step | time |
| --- | --- |
| decode + resample (Web Audio) | 41 ms |
| model load (230 KB ONNX + 14 MB wasm, first time) | 325 ms |
| inference, 44 windows in batches of 8 | 1.6 s |
| note tracking + monophonic rule | 750 ms |

Parity with the Python API (same settings, notes matched on pitch and a start
within 20 ms): a 22 s synthetic WAV matched 61 of 61; the 72 s MP3 matched
385 of 388, the remainder coming from the browser's MP3 decoder and resampler
differing from ffmpeg/librosa, not from the note tracking. Threads are off unless the page is cross-origin isolated
(COOP/COEP headers); enabling them and the WebGPU build are the obvious next
speedups. The wasm download is the real cost: ~14 MB (about 4 MB compressed),
cached by the browser after the first visit.
