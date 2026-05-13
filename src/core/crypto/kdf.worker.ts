/// <reference lib="webworker" />
/*
 * KDF worker. Per FR-040 + research R6:
 *  - Preferred: Argon2id (via `argon2-browser`, WASM).
 *  - Fallback: PBKDF2-SHA-256 (Web Crypto, ≥ 600,000 iterations).
 *
 * The worker stays a worker — no main-thread calls. The main-thread
 * facade (`CryptoService`, T021) sends `KdfDeriveRequest` messages and
 * listens for `KdfResponse`.
 *
 * Argon2 WASM may fail to load (CSP, very old browsers). When the
 * request asks for Argon2id and the WASM fails, we transparently fall
 * back to PBKDF2 with the supplied salt and report `used: 'pbkdf2-sha256'`
 * so the caller can persist the actually-used KDF descriptor.
 */
import type { KdfDeriveRequest, KdfRequest, KdfResponse } from '../workers/messages.js';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const asBufferSource = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

const deriveWithPbkdf2 = async (
  passphrase: string,
  saltBytes: Uint8Array,
  iterations: number,
  hashLengthBytes: number,
): Promise<Uint8Array> => {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: asBufferSource(saltBytes),
      iterations,
    },
    baseKey,
    hashLengthBytes * 8,
  );
  return new Uint8Array(bits);
};

const tryDeriveWithArgon2 = async (
  passphrase: string,
  saltBytes: Uint8Array,
  params: { memoryKib: number; iterations: number; parallelism: number; hashLength: number },
): Promise<Uint8Array | null> => {
  // Lazy import keeps the worker functional even when argon2-browser fails
  // to resolve (e.g. CSP blocks the WASM fetch).
  try {
    interface Argon2Module {
      hash: (opts: {
        pass: string;
        salt: Uint8Array;
        type: number;
        time: number;
        mem: number;
        parallelism: number;
        hashLen: number;
      }) => Promise<{ hash: Uint8Array }>;
      ArgonType: { Argon2id: number };
    }
    // Use the self-contained bundled build to avoid Vite's WASM ESM issues.
    const mod = (await import('argon2-browser/dist/argon2-bundled.min.js')) as unknown as {
      default?: Argon2Module;
    } & Argon2Module;
    const argon2: Argon2Module = mod.default ?? mod;
    const result = await argon2.hash({
      pass: passphrase,
      salt: saltBytes,
      type: argon2.ArgonType.Argon2id,
      time: params.iterations,
      mem: params.memoryKib,
      parallelism: params.parallelism,
      hashLen: params.hashLength,
    });
    return result.hash;
  } catch {
    return null;
  }
};

const handleDerive = async (req: KdfDeriveRequest): Promise<KdfResponse> => {
  const { descriptor } = req;
  const saltBytes = base64ToBytes(descriptor.salt);
  try {
    if (descriptor.name === 'argon2id') {
      const argonOut = await tryDeriveWithArgon2(req.passphrase, saltBytes, descriptor.params);
      if (argonOut) {
        return {
          kind: 'derive-ok',
          requestId: req.requestId,
          keyBase64: bytesToBase64(argonOut),
          used: 'argon2id',
        };
      }
      // Fallback: PBKDF2 with the same salt and a high iteration count.
      const fallbackBytes = await deriveWithPbkdf2(
        req.passphrase,
        saltBytes,
        600_000,
        descriptor.params.hashLength,
      );
      return {
        kind: 'derive-ok',
        requestId: req.requestId,
        keyBase64: bytesToBase64(fallbackBytes),
        used: 'pbkdf2-sha256',
      };
    }
    // pbkdf2-sha256 explicitly requested.
    const bytes = await deriveWithPbkdf2(
      req.passphrase,
      saltBytes,
      descriptor.params.iterations,
      descriptor.params.hashLength,
    );
    return {
      kind: 'derive-ok',
      requestId: req.requestId,
      keyBase64: bytesToBase64(bytes),
      used: 'pbkdf2-sha256',
    };
  } catch (e) {
    return {
      kind: 'derive-err',
      requestId: req.requestId,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
};

ctx.addEventListener('message', (event: MessageEvent<KdfRequest>) => {
  const req = event.data;
  if (req.kind === 'derive') {
    void (async () => {
      const response = await handleDerive(req);
      ctx.postMessage(response);
    })();
  }
});
