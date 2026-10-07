/**
 * Explicit, resumable download of what browser transcription needs: the ONNX model (~230 KB) and
 * ONNX Runtime's wasm (~14 MB). Nothing here touches the network until `downloadAssets` is called.
 * Downloads are kept in Cache Storage so later visits are ready without fetching again.
 */

export type AssetUrls = { modelUrl: string; wasmUrl: string };
export type TranscriberAssets = { model: Uint8Array; wasmBinary: ArrayBuffer };
export type AssetName = 'model' | 'runtime';
export type AssetProgress = {
  /** bytes received so far, across both files */
  loaded: number;
  /** bytes expected, across both files; may grow as sizes become known */
  total: number;
  /** what is downloading right now */
  current: AssetName | null;
  done: AssetName[];
};

const CACHE_NAME = 'ott-transcribe-v1';

/** Rough sizes to show before anything is fetched. Real sizes replace them during download. */
export const APPROX_SIZES: Record<AssetName, number> = {
  model: 230_444,
  runtime: 14_239_897,
};

const cacheApi = () => (typeof caches !== 'undefined' ? caches : null);

/** True when both files are already stored on this device. No network. */
export async function areAssetsCached(urls: AssetUrls): Promise<boolean> {
  const c = cacheApi();
  if (!c) return false;
  const cache = await c.open(CACHE_NAME);
  const [m, w] = await Promise.all([
    cache.match(urls.modelUrl),
    cache.match(urls.wasmUrl),
  ]);
  return Boolean(m && w);
}

/** Bytes stored for the two files, or 0 if not cached. No network. */
export async function cachedBytes(urls: AssetUrls): Promise<number> {
  const c = cacheApi();
  if (!c) return 0;
  const cache = await c.open(CACHE_NAME);
  let total = 0;
  for (const url of [urls.modelUrl, urls.wasmUrl]) {
    const r = await cache.match(url);
    if (r) total += (await r.clone().arrayBuffer()).byteLength;
  }
  return total;
}

/** Remove the stored files so the next transcription asks to download again. */
export async function removeAssets(): Promise<void> {
  const c = cacheApi();
  if (c) await c.delete(CACHE_NAME);
}

async function readWithProgress(
  res: Response,
  onChunk: (bytes: number, expected: number | null) => void
): Promise<Uint8Array> {
  const expectedHeader = res.headers.get('content-length');
  // content-length is the compressed size when the server gzips; treat it as unknown if we overshoot
  let expected: number | null = expectedHeader ? Number(expectedHeader) : null;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (expected !== null && received > expected) expected = null;
    onChunk(received, expected);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const ch of chunks) {
    out.set(ch, offset);
    offset += ch.byteLength;
  }
  return out;
}

/**
 * Fetch (or read from cache) both files, reporting progress. Resolves with bytes ready to hand to
 * `BasicPitchOnnx.load`.
 */
export async function downloadAssets(
  urls: AssetUrls,
  onProgress?: (p: AssetProgress) => void
): Promise<TranscriberAssets> {
  const c = cacheApi();
  const cache = c ? await c.open(CACHE_NAME) : null;
  const sizes: Record<AssetName, number> = { ...APPROX_SIZES };
  const received: Record<AssetName, number> = { model: 0, runtime: 0 };
  const done: AssetName[] = [];
  const report = (current: AssetName | null) =>
    onProgress?.({
      loaded: received.model + received.runtime,
      total: sizes.model + sizes.runtime,
      current,
      done: [...done],
    });

  const get = async (name: AssetName, url: string): Promise<Uint8Array> => {
    const hit = cache ? await cache.match(url) : null;
    if (hit) {
      const buf = new Uint8Array(await hit.arrayBuffer());
      sizes[name] = received[name] = buf.byteLength;
      done.push(name);
      report(null);
      return buf;
    }
    report(name);
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`${name}: ${res.status} ${res.statusText} for ${url}`);
    const bytes = await readWithProgress(res, (n, expected) => {
      received[name] = n;
      if (expected !== null) sizes[name] = expected;
      else if (n > sizes[name]) sizes[name] = n;
      report(name);
    });
    sizes[name] = received[name] = bytes.byteLength;
    done.push(name);
    report(null);
    if (cache) {
      const type =
        name === 'runtime' ? 'application/wasm' : 'application/octet-stream';
      await cache.put(
        url,
        new Response(bytes.slice(0), {
          headers: {
            'content-type': type,
            'content-length': String(bytes.byteLength),
          },
        })
      );
    }
    return bytes;
  };

  report(null);
  const model = await get('model', urls.modelUrl);
  const wasm = await get('runtime', urls.wasmUrl);
  return {
    model,
    wasmBinary: wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength
    ) as ArrayBuffer,
  };
}

export const formatBytes = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)} MB`
    : `${Math.round(n / 1000)} KB`;
