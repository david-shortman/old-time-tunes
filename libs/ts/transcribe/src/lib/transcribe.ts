import type { OTTNote } from '@ot-tunes/notes';
import { decodeToModelRate } from './audio';
import { BasicPitchOnnx, type ModelOptions } from './model';
import { outputToNotes, type PostprocessOptions } from './postprocess';

export type TranscribeTiming = { decodeMs: number; loadMs: number; inferMs: number; postMs: number; audioSeconds: number };
export type TranscribeResult = { notes: OTTNote[]; timing: TranscribeTiming };

let cached: { key: string; model: Promise<BasicPitchOnnx> } | null = null;

/** Load the model once per page; subsequent calls with the same options reuse it. */
export function getModel(opts: ModelOptions): Promise<BasicPitchOnnx> {
  const key = JSON.stringify({ ...opts, assets: opts.assets ? 'bytes' : undefined });
  if (!cached || cached.key !== key) cached = { key, model: BasicPitchOnnx.load(opts) };
  return cached.model;
}

/** Decode an audio file, run Basic Pitch in the browser, and post-process to notes. */
export async function transcribeAudio(
  data: ArrayBuffer,
  model: ModelOptions,
  post: PostprocessOptions = {},
  onProgress?: (fraction: number) => void
): Promise<TranscribeResult> {
  const t0 = performance.now();
  const samples = await decodeToModelRate(data);
  const t1 = performance.now();
  const m = await getModel(model);
  const t2 = performance.now();
  const output = await m.run(samples, (done, total) => onProgress?.(done / total));
  const t3 = performance.now();
  const notes = outputToNotes(output, post);
  const t4 = performance.now();
  return {
    notes,
    timing: { decodeMs: t1 - t0, loadMs: t2 - t1, inferMs: t3 - t2, postMs: t4 - t3, audioSeconds: samples.length / 22050 },
  };
}
