import { describe, it, expect } from 'vitest';

import { EncryptedExport } from '../services/encrypted-export.js';

describe('EncryptedExport', () => {
  it('produces a parseable JSON payload with the expected shape', async () => {
    const encryptor = new EncryptedExport();
    const plaintext = JSON.stringify({ test: 'value', records: [1, 2, 3] });
    const passphrase = 'test-passphrase-12345678';

    const result = await encryptor.encrypt(plaintext, passphrase);
    const parsed = JSON.parse(result) as Record<string, unknown>;

    expect(parsed['kind']).toBe('autokeep-encrypted-export');
    expect(parsed['schemaVersion']).toBe(1);
    expect(typeof parsed['encryptedData']).toBe('string');
    expect(typeof parsed['iv']).toBe('string');
    expect(parsed['kdf']).toBeDefined();
    expect((parsed['kdf'] as Record<string, unknown>)['name']).toBe('pbkdf2-sha256');
  });

  it('different passphrases produce different ciphertexts', async () => {
    const encryptor = new EncryptedExport();
    const plaintext = 'same plaintext';

    const r1 = JSON.parse(await encryptor.encrypt(plaintext, 'passphrase-A')) as Record<
      string,
      unknown
    >;
    const r2 = JSON.parse(await encryptor.encrypt(plaintext, 'passphrase-B')) as Record<
      string,
      unknown
    >;

    expect(r1['encryptedData']).not.toBe(r2['encryptedData']);
  });

  it('different calls with same passphrase produce different IVs', async () => {
    const encryptor = new EncryptedExport();
    const passphrase = 'same-passphrase-here';
    const plaintext = 'same data';

    const r1 = JSON.parse(await encryptor.encrypt(plaintext, passphrase)) as Record<
      string,
      unknown
    >;
    const r2 = JSON.parse(await encryptor.encrypt(plaintext, passphrase)) as Record<
      string,
      unknown
    >;

    // IVs must be randomly generated; collision probability is negligible
    expect(r1['iv']).not.toBe(r2['iv']);
  });
});
