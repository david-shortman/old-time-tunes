'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPROX_SIZES,
  areAssetsCached,
  cachedBytes,
  downloadAssets,
  removeAssets,
  type AssetProgress,
  type AssetUrls,
  type TranscriberAssets,
} from '@ot-tunes/transcribe';

export type AssetStatus =
  | 'checking'
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'error';

export type TranscriberAssetsState = {
  status: AssetStatus;
  progress: AssetProgress | null;
  /** bytes stored on this device once ready */
  storedBytes: number;
  approxBytes: number;
  error: string | null;
  /** resolves with bytes to hand to the transcriber; downloads only if needed */
  ensure: () => Promise<TranscriberAssets>;
  remove: () => Promise<void>;
};

/** Tracks whether the browser transcriber's files are on this device. Never fetches on its own. */
export function useTranscriberAssets(urls: AssetUrls): TranscriberAssetsState {
  const [status, setStatus] = useState<AssetStatus>('checking');
  const [progress, setProgress] = useState<AssetProgress | null>(null);
  const [storedBytes, setStoredBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const assetsRef = useRef<TranscriberAssets | null>(null);
  const inflight = useRef<Promise<TranscriberAssets> | null>(null);

  useEffect(() => {
    let cancelled = false;
    areAssetsCached(urls)
      .then(async (cached) => {
        if (cancelled) return;
        if (cached) setStoredBytes(await cachedBytes(urls));
        setStatus(cached ? 'ready' : 'idle');
      })
      .catch(() => !cancelled && setStatus('idle'));
    return () => {
      cancelled = true;
    };
  }, [urls]);

  const ensure = useCallback(() => {
    if (assetsRef.current) return Promise.resolve(assetsRef.current);
    if (inflight.current) return inflight.current;
    setStatus('downloading');
    setError(null);
    inflight.current = downloadAssets(urls, setProgress)
      .then((a) => {
        assetsRef.current = a;
        setStoredBytes(a.model.byteLength + a.wasmBinary.byteLength);
        setStatus('ready');
        return a;
      })
      .catch((e: Error) => {
        setError(e.message);
        setStatus('error');
        throw e;
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [urls]);

  const remove = useCallback(async () => {
    await removeAssets();
    assetsRef.current = null;
    setStoredBytes(0);
    setProgress(null);
    setStatus('idle');
  }, []);

  return {
    status,
    progress,
    storedBytes,
    approxBytes: APPROX_SIZES.model + APPROX_SIZES.runtime,
    error,
    ensure,
    remove,
  };
}
