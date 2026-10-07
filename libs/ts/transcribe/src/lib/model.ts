import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { ANNOT_N_FRAMES, AUDIO_N_SAMPLES, N_CONTOUR_BINS, N_PITCH_BINS, ONNX_INPUT, ONNX_OUTPUTS } from './constants';
import { unwrapOutput, windowAudio } from './windowing';
import type { TranscriberAssets } from './assets';

export type ModelOutput = { note: number[][]; onset: number[][]; contour: number[][] };

export type ModelOptions = {
  /** URL of nmp.onnx (ignored when `assets` is given) */
  modelUrl: string;
  /** Directory URL holding onnxruntime-web's loader .mjs and .wasm files (trailing slash). */
  wasmPaths: string;
  /** Pre-downloaded bytes from `downloadAssets`; lets the app show its own progress and cache them. */
  assets?: TranscriberAssets;
  /** Windows per inference call. Higher is faster, uses more memory. */
  batchSize?: number;
  /** Worker threads; needs cross-origin isolation to be > 1. */
  numThreads?: number;
  /** 'webgpu' needs the jsep wasm build; 'wasm' works everywhere. */
  backend?: 'wasm' | 'webgpu';
};

type Ort = typeof import('onnxruntime-web');

/** Spotify's Basic Pitch model running in the browser through ONNX Runtime Web. */
export class BasicPitchOnnx {
  private constructor(private readonly ort: Ort, private readonly session: InferenceSession, private readonly batchSize: number) {}

  static async load(opts: ModelOptions): Promise<BasicPitchOnnx> {
    // Load the runtime from the host app's static files at run time rather than bundling it:
    // the ESM build uses import.meta and worker URLs that production bundlers mangle, and this
    // keeps the 14 MB wasm and its loader out of the app bundle entirely.
    const loader = `${opts.wasmPaths}${opts.backend === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`;
    const ort = (await import(/* webpackIgnore: true */ loader)) as unknown as Ort;
    ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.assets) ort.env.wasm.wasmBinary = opts.assets.wasmBinary;
    ort.env.wasm.numThreads = opts.numThreads ?? (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1);
    const sessionOptions: InferenceSession.SessionOptions = {
      executionProviders: opts.backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
      graphOptimizationLevel: 'all',
    };
    const session = opts.assets
      ? await ort.InferenceSession.create(opts.assets.model, sessionOptions)
      : await ort.InferenceSession.create(opts.modelUrl, sessionOptions);
    return new BasicPitchOnnx(ort, session, opts.batchSize ?? 8);
  }

  /** Run the model over mono 22.05 kHz samples. */
  async run(samples: Float32Array, onProgress?: (done: number, total: number) => void): Promise<ModelOutput> {
    const { data, nWindows } = windowAudio(samples);
    const note = new Float32Array(nWindows * ANNOT_N_FRAMES * N_PITCH_BINS);
    const onset = new Float32Array(nWindows * ANNOT_N_FRAMES * N_PITCH_BINS);
    const contour = new Float32Array(nWindows * ANNOT_N_FRAMES * N_CONTOUR_BINS);
    for (let w0 = 0; w0 < nWindows; w0 += this.batchSize) {
      const n = Math.min(this.batchSize, nWindows - w0);
      const input = new this.ort.Tensor('float32', data.subarray(w0 * AUDIO_N_SAMPLES, (w0 + n) * AUDIO_N_SAMPLES), [n, AUDIO_N_SAMPLES, 1]);
      const out = await this.session.run({ [ONNX_INPUT]: input });
      note.set((out[ONNX_OUTPUTS.note] as Tensor).data as Float32Array, w0 * ANNOT_N_FRAMES * N_PITCH_BINS);
      onset.set((out[ONNX_OUTPUTS.onset] as Tensor).data as Float32Array, w0 * ANNOT_N_FRAMES * N_PITCH_BINS);
      contour.set((out[ONNX_OUTPUTS.contour] as Tensor).data as Float32Array, w0 * ANNOT_N_FRAMES * N_CONTOUR_BINS);
      onProgress?.(w0 + n, nWindows);
    }
    return {
      note: unwrapOutput(note, nWindows, N_PITCH_BINS, samples.length),
      onset: unwrapOutput(onset, nWindows, N_PITCH_BINS, samples.length),
      contour: unwrapOutput(contour, nWindows, N_CONTOUR_BINS, samples.length),
    };
  }

  release(): Promise<void> {
    return this.session.release();
  }
}
