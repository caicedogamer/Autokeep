/*
 * Money helpers for minor-unit arithmetic and formatting.
 * No DOM, no I/O. All operations are pure functions.
 *
 * Minor units: amounts are stored as integers (e.g., 1099 = $10.99 in ARS
 * with 2 decimal digits, or 1099 = ¥1099 in JPY with 0 decimal digits).
 */

import type { MoneyMinor } from './types.js';
import { toMoneyMinor } from './types.js';

/* ---------- Arithmetic (overflow-safe) ---------- */

/**
 * Add two minor-unit amounts.
 * Throws if the result would overflow Number.MAX_SAFE_INTEGER.
 */
export const add = (a: MoneyMinor, b: MoneyMinor): MoneyMinor => {
  const result = a + b;
  if (result > Number.MAX_SAFE_INTEGER) throw new RangeError('Money addition overflow');
  return toMoneyMinor(result);
};

export const subtract = (a: MoneyMinor, b: MoneyMinor): MoneyMinor => toMoneyMinor(a - b);

/** Sum an array of minor-unit values. Returns 0 for empty arrays. */
export const sum = (values: readonly MoneyMinor[]): MoneyMinor =>
  values.reduce<MoneyMinor>((acc, v) => add(acc, v), toMoneyMinor(0));

/* ---------- Comparison ---------- */

export const gt = (a: MoneyMinor, b: MoneyMinor): boolean => a > b;
export const gte = (a: MoneyMinor, b: MoneyMinor): boolean => a >= b;
export const lt = (a: MoneyMinor, b: MoneyMinor): boolean => a < b;
export const lte = (a: MoneyMinor, b: MoneyMinor): boolean => a <= b;
export const eq = (a: MoneyMinor, b: MoneyMinor): boolean => a === b;

/* ---------- Conversion ---------- */

/**
 * Parse a decimal string into minor units.
 * E.g., "10.99" with minorDigits=2 → 1099.
 * E.g., "1099" with minorDigits=0 → 1099.
 * Rejects NaN, Infinity, or negative values.
 */
export const fromDecimalString = (raw: string, minorDigits: 0 | 2 | 3): MoneyMinor => {
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError(`Invalid decimal string: "${raw}"`);
  }
  const factor = 10 ** minorDigits;
  const decimal = parseFloat(trimmed);
  if (!Number.isFinite(decimal) || decimal < 0) {
    throw new RangeError(`Amount must be a non-negative finite number: "${raw}"`);
  }
  // Round to avoid floating-point artifacts (e.g., 10.99 * 100 = 1098.9999...)
  const minor = Math.round(decimal * factor);
  return toMoneyMinor(minor);
};

/**
 * Convert minor units back to a decimal string with the correct number of
 * decimal places for display (e.g., 1099 with minorDigits=2 → "10.99").
 */
export const toDecimalString = (amount: MoneyMinor, minorDigits: 0 | 2 | 3): string => {
  if (minorDigits === 0) return String(amount);
  const factor = 10 ** minorDigits;
  const whole = Math.floor(amount / factor);
  const frac = amount % factor;
  return `${String(whole)}.${String(frac).padStart(minorDigits, '0')}`;
};

/**
 * Format minor units as a locale-aware currency string.
 * Uses Intl.NumberFormat; caches are managed by the i18n/format module.
 * This helper is intentionally simple — the i18n layer owns caching.
 */
export const formatCurrency = (
  amount: MoneyMinor,
  currencyCode: string,
  minorDigits: 0 | 2 | 3,
  locale: string,
): string => {
  const decimal = amount / 10 ** minorDigits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: minorDigits,
    maximumFractionDigits: minorDigits,
  }).format(decimal);
};

/* ---------- Validation ---------- */

/** Returns true iff `n` is a valid positive integer minor-unit amount. */
export const isValidMinorAmount = (n: unknown): n is MoneyMinor =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER;
