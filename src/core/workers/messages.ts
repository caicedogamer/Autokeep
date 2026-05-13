/*
 * Shared worker message contracts.
 *
 * Each pair (Request / Response) is the wire protocol between a main-
 * thread facade (`CryptoService`, `FilterCoordinator`, `ImportService`)
 * and its dedicated worker. Discriminated unions make exhaustive
 * handling enforceable by the compiler.
 *
 * IMPORTANT: anything carried across `postMessage` MUST be structured-
 * cloneable — no functions, no class instances. Plain data only.
 */

/* ---------- KDF worker (T020) ---------- */

export type KdfName = 'argon2id' | 'pbkdf2-sha256';

export interface Argon2idParams {
  /** Memory cost in KiB. */
  readonly memoryKib: number;
  /** Time cost (iterations). */
  readonly iterations: number;
  /** Parallelism (lanes). */
  readonly parallelism: number;
  /** Output length in bytes. AES-256 wants 32. */
  readonly hashLength: number;
}

export interface Pbkdf2Params {
  readonly iterations: number;
  /** Output length in bytes. AES-256 wants 32. */
  readonly hashLength: number;
}

export type KdfDescriptor =
  | {
      readonly name: 'argon2id';
      readonly salt: string /* base64 */;
      readonly params: Argon2idParams;
    }
  | {
      readonly name: 'pbkdf2-sha256';
      readonly salt: string /* base64 */;
      readonly params: Pbkdf2Params;
    };

export interface KdfDeriveRequest {
  readonly kind: 'derive';
  readonly requestId: string;
  readonly passphrase: string;
  readonly descriptor: KdfDescriptor;
}

export type KdfRequest = KdfDeriveRequest;

export interface KdfDeriveOk {
  readonly kind: 'derive-ok';
  readonly requestId: string;
  /** Raw key bytes, length = `descriptor.params.hashLength`, base64-encoded. */
  readonly keyBase64: string;
  /** Which KDF actually ran (may differ from the request if Argon2 fell back). */
  readonly used: KdfName;
}

export interface KdfDeriveErr {
  readonly kind: 'derive-err';
  readonly requestId: string;
  readonly reason: string;
}

export type KdfResponse = KdfDeriveOk | KdfDeriveErr;

/* ---------- Filter worker (T048, stub for now) ---------- */

export interface FilterRequest {
  readonly kind: 'apply';
  readonly requestId: number;
  readonly recordsSnapshotVersion: number;
  /** The records to filter, as a structured-clonable plain array. */
  readonly records: readonly unknown[]; // typed precisely once US2 lands
  /** Active FilterState. */
  readonly filterState: unknown; // typed precisely once US2 lands
}

export interface FilterResponse {
  readonly kind: 'apply-ok';
  readonly requestId: number;
  /** Matching record ids, in stable order. */
  readonly ids: readonly string[];
  readonly count: number;
}

/* ---------- Import worker (T061, stub for now) ---------- */

export interface ImportRequest {
  readonly kind: 'import';
  readonly requestId: string;
  readonly fileKind: 'csv' | 'json';
  readonly fileBuffer: ArrayBuffer;
  readonly ctx: {
    readonly currency: string;
    readonly currencyMinorUnits: 0 | 2 | 3;
    readonly existingCount: number;
  };
}

export interface ImportProgressMessage {
  readonly kind: 'import-progress';
  readonly requestId: string;
  /** Rows scanned so far (0..total). */
  readonly scanned: number;
  /** Total rows known so far (may grow during streaming). */
  readonly totalKnown: number;
}

export interface ImportFinalMessage {
  readonly kind: 'import-final';
  readonly requestId: string;
  /** True iff structural validation passed (no per-row issues prevent commit by themselves). */
  readonly structuralOk: boolean;
  /** Opaque report payload — typed precisely once T058 lands. */
  readonly report: unknown;
}

export interface ImportCancelRequest {
  readonly kind: 'cancel';
  readonly requestId: string;
}

export type ImportInbound = ImportRequest | ImportCancelRequest;
export type ImportOutbound = ImportProgressMessage | ImportFinalMessage;
