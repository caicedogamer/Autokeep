/*
 * Result<T, E> — explicit success/failure at module boundaries.
 *
 * Constitution Principle VI requires explicit error handling: no silent
 * `catch` blocks, no thrown non-Error values, no implicit `any` at module
 * boundaries. This helper makes failures part of the type so callers
 * cannot forget them.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;
export type AsyncResult<T, E> = Promise<Result<T, E>>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/**
 * Maps the success value. Errors pass through unchanged.
 */
export const map = <T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

/**
 * Maps the error value. Successes pass through unchanged.
 */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error));

/**
 * Chains a Result-returning operation. Stops at the first error.
 */
export const andThen = <T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> =>
  r.ok ? f(r.value) : r;

/**
 * Wraps a thrown function so the failure becomes an explicit Result.
 * The thrown value is normalized to an `Error` (Principle VI bans
 * thrown non-Error values).
 */
export const tryCatch = <T>(fn: () => T): Result<T, Error> => {
  try {
    return ok(fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};

/**
 * Async variant of {@link tryCatch}.
 */
export const tryCatchAsync = async <T>(fn: () => Promise<T>): AsyncResult<T, Error> => {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};

/**
 * Unwraps a Result, throwing the error if it is a failure. Should only
 * be used at the very edge of an operation (e.g. inside a UI handler
 * that has its own outer try/catch). Internal code MUST pattern-match.
 */
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.ok) return r.value;
  if (r.error instanceof Error) throw r.error;
  throw new Error(`unwrap on Err: ${String(r.error)}`);
};

/* ---------- Typed error base classes ---------- */

/**
 * Base class for AutoKeep domain errors. Always carries a stable `code`
 * so callers can pattern-match without string-comparing messages.
 */
export abstract class AutoKeepError extends Error {
  public abstract readonly code: string;
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Thrown when an invariant from data-model.md is violated.
 */
export class DomainError extends AutoKeepError {
  public readonly code = 'DOMAIN_ERROR';
  public constructor(
    message: string,
    public readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
