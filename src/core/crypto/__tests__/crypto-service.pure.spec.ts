/*
 * Pure-logic tests for CryptoService. Runs in the Node environment
 * (`*.pure.spec.ts` glob in vitest.config.ts) using Node's built-in
 * Web Crypto. The KDF worker is replaced with a small in-process mock
 * so the tests are deterministic and fast.
 *
 * Verifies:
 *  - AES-256-GCM round-trips
 *  - Same plaintext + same key produces DIFFERENT ciphertexts (random IV)
 *  - Decryption with the wrong key raises CryptoDecryptError, never
 *    returns plaintext (SC-014, SC-015 base layer)
 *  - AAD mismatch raises CryptoDecryptError
 *  - lock() makes subsequent encrypt/decrypt throw CryptoUnlockError
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  CryptoService,
  CryptoUnlockError,
  CryptoDecryptError,
  type CryptoServiceDeps,
  type KdfWorkerLike,
  type CryptoAad,
  type EncryptedBlob,
  generateRandomBase64,
} from '../crypto-service.js';
import type { KdfDescriptor, KdfRequest, KdfResponse } from '../../workers/messages.js';

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = Buffer.from(b64, 'base64');
  return new Uint8Array(binary);
};
const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/**
 * Mock KDF worker that runs PBKDF2 in-process via Node's webcrypto.
 * Always reports `used: 'pbkdf2-sha256'`. Iteration count is reduced
 * to 1000 so the test suite stays fast — security-relevant iteration
 * count belongs to the production worker, not this mock.
 */
const mockKdfWorker = (): KdfWorkerLike => {
  const listeners = new Set<(event: MessageEvent<KdfResponse>) => void>();
  return {
    postMessage(message: KdfRequest) {
      void (async () => {
        if (message.kind !== 'derive') return;
        const enc = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
          'raw',
          enc.encode(message.passphrase),
          { name: 'PBKDF2' },
          false,
          ['deriveBits'],
        );
        const salt = base64ToBytes(message.descriptor.salt);
        const bits = await crypto.subtle.deriveBits(
          {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: salt as BufferSource,
            iterations: 1000, // fast for tests
          },
          baseKey,
          message.descriptor.params.hashLength * 8,
        );
        const response: KdfResponse = {
          kind: 'derive-ok',
          requestId: message.requestId,
          keyBase64: bytesToBase64(new Uint8Array(bits)),
          used: 'pbkdf2-sha256',
        };
        const event = { data: response } as MessageEvent<KdfResponse>;
        for (const listener of [...listeners]) listener(event);
      })();
    },
    addEventListener(_type: 'message', listener) {
      listeners.add(listener);
    },
    removeEventListener(_type: 'message', listener) {
      listeners.delete(listener);
    },
    terminate() {
      listeners.clear();
    },
  };
};

const makeService = (): CryptoService => {
  const deps: CryptoServiceDeps = { createKdfWorker: mockKdfWorker };
  return new CryptoService(deps);
};

const makeDescriptor = (): KdfDescriptor => ({
  name: 'pbkdf2-sha256',
  salt: generateRandomBase64(16),
  params: { iterations: 1000, hashLength: 32 },
});

const aad: CryptoAad = { workspaceId: 'ws-test', schemaVersion: 1 };

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    service = makeService();
    await service.unlock('correct horse battery staple', makeDescriptor());
  });

  it('AES-256-GCM round-trips plaintext exactly', async () => {
    const plaintext = new TextEncoder().encode('Factura A 0001-00012345 / Acme S.A. / 15000.00');
    const blob = await service.encrypt(plaintext, aad);
    const decrypted = await service.decrypt(blob, aad);
    expect(new TextDecoder().decode(decrypted)).toBe(
      'Factura A 0001-00012345 / Acme S.A. / 15000.00',
    );
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const plaintext = new TextEncoder().encode('repeated payload');
    const blob1 = await service.encrypt(plaintext, aad);
    const blob2 = await service.encrypt(plaintext, aad);
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext);
    expect(blob1.iv).not.toBe(blob2.iv);
  });

  it('decryption with the WRONG key raises CryptoDecryptError and never returns plaintext', async () => {
    const plaintext = new TextEncoder().encode('sensitive');
    const blob = await service.encrypt(plaintext, aad);

    // Build an entirely separate service with a different passphrase,
    // unlocked against the same descriptor (different derived key).
    const wrongService = makeService();
    await wrongService.unlock('a different passphrase', makeDescriptor());

    await expect(wrongService.decrypt(blob, aad)).rejects.toBeInstanceOf(CryptoDecryptError);
  });

  it('decryption with mismatched AAD raises CryptoDecryptError', async () => {
    const plaintext = new TextEncoder().encode('aad-bound payload');
    const blob = await service.encrypt(plaintext, aad);
    await expect(
      service.decrypt(blob, { workspaceId: 'OTHER-WORKSPACE', schemaVersion: 1 }),
    ).rejects.toBeInstanceOf(CryptoDecryptError);
  });

  it('decryption of a tampered ciphertext raises CryptoDecryptError', async () => {
    const plaintext = new TextEncoder().encode('untampered');
    const blob = await service.encrypt(plaintext, aad);
    // Flip a single bit in the ciphertext.
    const tampered: EncryptedBlob = {
      iv: blob.iv,
      ciphertext: bytesToBase64(
        (() => {
          const bytes = base64ToBytes(blob.ciphertext);
          bytes[0] = (bytes[0] ?? 0) ^ 0x01;
          return bytes;
        })(),
      ),
    };
    await expect(service.decrypt(tampered, aad)).rejects.toBeInstanceOf(CryptoDecryptError);
  });

  it('lock() clears the in-memory key; subsequent encrypt/decrypt throws CryptoUnlockError', async () => {
    const blob = await service.encrypt(new TextEncoder().encode('x'), aad);
    service.lock();
    expect(service.isUnlocked()).toBe(false);
    await expect(service.encrypt(new TextEncoder().encode('y'), aad)).rejects.toBeInstanceOf(
      CryptoUnlockError,
    );
    await expect(service.decrypt(blob, aad)).rejects.toBeInstanceOf(CryptoUnlockError);
  });
});
