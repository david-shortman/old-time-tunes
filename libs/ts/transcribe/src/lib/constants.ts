/** Basic Pitch model geometry. Mirrors basic_pitch/constants.py and the TS package. */
export const AUDIO_SAMPLE_RATE = 22050;
export const FFT_HOP = 256;
export const AUDIO_WINDOW_LENGTH_SECONDS = 2;
/** samples per model input window */
export const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_WINDOW_LENGTH_SECONDS - FFT_HOP; // 43844
/** output frames per window */
export const ANNOT_N_FRAMES = 172;
export const N_PITCH_BINS = 88;
export const N_CONTOUR_BINS = 264;
export const CONTOURS_BINS_PER_SEMITONE = 3;
/** frames per second of the output; Python uses the floored value for trimming */
export const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP); // 86
export const N_OVERLAPPING_FRAMES = 30;
export const OVERLAP_LENGTH = N_OVERLAPPING_FRAMES * FFT_HOP; // 7680 samples
export const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH; // 36164 samples
export const N_OVERLAP_OVER_2 = N_OVERLAPPING_FRAMES / 2; // 15 frames

/** ONNX graph output names, as exported by Spotify (verified against the TF SavedModel). */
export const ONNX_INPUT = 'serving_default_input_2:0';
export const ONNX_OUTPUTS = {
  contour: 'StatefulPartitionedCall:0',
  note: 'StatefulPartitionedCall:1',
  onset: 'StatefulPartitionedCall:2',
} as const;
