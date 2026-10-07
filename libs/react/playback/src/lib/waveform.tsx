import { useEffect, useMemo, useRef } from 'react';
import { waveformPeaks } from './synth';
import styles from './ott-react-playback.module.css';

type Props = {
  buffer: AudioBuffer | null;
  /** seconds covered by `width` pixels */
  duration: number;
  width: number;
  height: number;
  color: string;
  /** time scale of the buffer relative to the timeline (synth rendered at 0.5× speed → 0.5) */
  bufferRate?: number;
  /** seconds already played; bars before it use `playedColor` */
  progress?: number;
  playedColor?: string;
  /** draw bars mirrored around the middle (default) or rising from the bottom */
  baseline?: 'middle' | 'bottom';
};

/** A canvas waveform drawn at an explicit pixel width so it can share a zoomable time axis. */
export function Waveform({
  buffer,
  duration,
  width,
  height,
  color,
  bufferRate = 1,
  progress,
  playedColor,
  baseline = 'middle',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bins = Math.max(1, Math.floor(width / 2));
  const peaks = useMemo(
    () =>
      buffer && duration > 0
        ? waveformPeaks(buffer, bins, duration / bufferRate)
        : null,
    [buffer, bins, duration, bufferRate]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (!peaks) return;
    let norm = 0;
    for (let i = 0; i < peaks.length; i++) if (peaks[i] > norm) norm = peaks[i];
    norm = norm || 1;
    const barW = width / peaks.length;
    const playedBars =
      progress !== undefined && duration > 0
        ? Math.floor((progress / duration) * peaks.length)
        : -1;
    for (let i = 0; i < peaks.length; i++) {
      ctx.fillStyle = i < playedBars && playedColor ? playedColor : color;
      if (baseline === 'bottom') {
        const h = (peaks[i] / norm) * (height - 2);
        ctx.fillRect(i * barW, height - h, Math.max(1, barW - 0.6), h || 1);
      } else {
        const mid = height / 2;
        const amp = (peaks[i] / norm) * (mid - 2);
        ctx.fillRect(
          i * barW,
          mid - amp,
          Math.max(1, barW - 0.4),
          amp * 2 || 1
        );
      }
    }
  }, [peaks, width, height, color, progress, playedColor, duration, baseline]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.waveCanvas}
      style={{ width, height }}
    />
  );
}
