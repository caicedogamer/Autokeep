/*
 * EncryptedExport — wraps a plaintext export payload in the same
 * AES-256-GCM envelope used for workspace storage (FR-040).
 *
 * The operator provides a passphrase (different from the workspace
 * passphrase is allowed but not required). The output is a JSON file
 * with the same encrypted-blob shape as the workspace, making it
 * importable by a future AutoKeep instance that knows the passphrase.
 *
 * This service is optional at export time (FR-040 says "if opted-in").
 */

export interface EncryptedExportPayload {
  readonly kind: 'autokeep-encrypted-export';
  readonly schemaVersion: 1;
  readonly encryptedData: string; // base64-encoded ciphertext
  readonly iv: string; // base64-encoded 12-byte IV
  readonly kdf: {
    readonly name: string;
    readonly salt: string; // base64-encoded salt
    readonly params: unknown;
  };
}

export class EncryptedExport {
  /**
   * Encrypts the given plaintext JSON string with the provided passphrase.
   * Returns a JSON string of an `EncryptedExportPayload`.
   */
  public async encrypt(plaintextJson: string, passphrase: string): Promise<string> {
    // Use the same AES-256-GCM + PBKDF2 path available in CryptoService.
    // We call the internal `encryptPayload` equivalent via the public
    // `createWorkspace`-level API is not available here; instead we use
    // the low-level `deriveKey` + `encrypt` approach.
    //
    // For now, delegate to CryptoService.encryptString which will be
    // exposed in a follow-up refactor. This stub exists so the type chain
    // compiles and the feature flag can be toggled without touching other
    // modules.
    const encoded = new TextEncoder().encode(plaintextJson);

    // Use SubtleCrypto directly: PBKDF2 → AES-GCM
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey'],
    );

    const key = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 600_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );

    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded,
    );

    const toBase64 = (buf: ArrayBuffer): string =>
      btoa(String.fromCharCode(...new Uint8Array(buf)));

    const payload: EncryptedExportPayload = {
      kind: 'autokeep-encrypted-export',
      schemaVersion: 1,
      encryptedData: toBase64(ciphertext),
      iv: toBase64(iv.buffer),
      kdf: {
        name: 'pbkdf2-sha256',
        salt: toBase64(saltBytes.buffer),
        params: { iterations: 600_000, hashLength: 32 },
      },
    };

    return JSON.stringify(payload, null, 2);
  }
}
