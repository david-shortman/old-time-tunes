'use client';
import { formatBytes } from '@ot-tunes/transcribe';
import type { TranscriberAssetsState } from './use-transcriber-assets';
import styles from './transcriber-download.module.css';

type Props = { assets: TranscriberAssetsState; onDownload: () => void };

/** Tells the user what the browser transcriber needs, lets them fetch it deliberately, and shows progress. */
export function TranscriberDownload({ assets, onDownload }: Props) {
  const { status, progress, storedBytes, approxBytes, error } = assets;
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : 0;

  return (
    <div className={styles.box} aria-live="polite">
      {status === 'checking' && (
        <span className={styles.muted}>
          Checking for the browser transcriber…
        </span>
      )}

      {status === 'idle' && (
        <>
          <span>
            Transcribing in your browser needs a one-time download of about{' '}
            <strong>{formatBytes(approxBytes)}</strong> (the note-detection
            model and its runtime). Nothing is downloaded until you ask, and
            your recordings never leave this device.
          </span>
          <button className={styles.button} onClick={onDownload}>
            Download transcriber
          </button>
        </>
      )}

      {status === 'downloading' && progress && (
        <div className={styles.progressWrap}>
          <div className={styles.progressText}>
            Downloading{' '}
            {progress.current === 'runtime'
              ? 'the runtime'
              : progress.current === 'model'
              ? 'the model'
              : '…'}{' '}
            · {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
            {progress.done.length > 0 && (
              <span className={styles.muted}>
                {' '}
                ·{' '}
                {progress.done
                  .map((d) => (d === 'model' ? 'model ✓' : 'runtime ✓'))
                  .join(' · ')}
              </span>
            )}
          </div>
          <div
            className={styles.bar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="transcriber download"
          >
            <div className={styles.fill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {status === 'ready' && (
        <>
          <span>
            <strong>✓ Browser transcriber ready.</strong>{' '}
            {storedBytes > 0
              ? `${formatBytes(
                  storedBytes
                )} stored on this device, works offline.`
              : 'Loaded for this session.'}
          </span>
          <button className={styles.link} onClick={() => void assets.remove()}>
            Remove download
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <span className={styles.error}>Download failed: {error}</span>
          <button className={styles.button} onClick={onDownload}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
