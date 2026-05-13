import { describe, it, expect } from 'vitest';

import {
  add,
  subtract,
  sum,
  gt,
  lte,
  eq,
  fromDecimalString,
  toDecimalString,
  isValidMinorAmount,
  formatCurrency,
} from '../domain/money.js';
import { toMoneyMinor } from '../domain/types.js';

const m = toMoneyMinor;

describe('add', () => {
  it('adds two positive amounts', () => {
    expect(add(m(100), m(250))).toBe(350);
  });
  it('throws on overflow', () => {
    expect(() => add(m(Number.MAX_SAFE_INTEGER), m(1))).toThrow(RangeError);
  });
});

describe('subtract', () => {
  it('returns negative values (callers enforce sign)', () => {
    expect(subtract(m(100), m(150))).toBe(-50);
  });
});

describe('sum', () => {
  it('returns 0 for empty array', () => {
    expect(sum([])).toBe(0);
  });
  it('sums array correctly', () => {
    expect(sum([m(100), m(200), m(50)])).toBe(350);
  });
});

describe('comparisons', () => {
  it('gt/lte work symmetrically', () => {
    expect(gt(m(200), m(100))).toBe(true);
    expect(lte(m(100), m(100))).toBe(true);
  });
  it('eq returns true for equal values', () => {
    expect(eq(m(500), m(500))).toBe(true);
  });
});

describe('fromDecimalString', () => {
  it('parses 2-decimal currency correctly', () => {
    expect(fromDecimalString('10.99', 2)).toBe(1099);
  });
  it('parses 0-decimal currency correctly', () => {
    expect(fromDecimalString('1500', 0)).toBe(1500);
  });
  it('parses 3-decimal currency correctly', () => {
    expect(fromDecimalString('1.500', 3)).toBe(1500);
  });
  it('rounds floating-point artifacts', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754
    expect(fromDecimalString('0.30', 2)).toBe(30);
  });
  it('throws on invalid input', () => {
    expect(() => fromDecimalString('abc', 2)).toThrow(RangeError);
  });
  it('throws on negative value', () => {
    expect(() => fromDecimalString('-10.00', 2)).toThrow(RangeError);
  });
});

describe('toDecimalString', () => {
  it('converts 2-decimal minor units to string', () => {
    expect(toDecimalString(m(1099), 2)).toBe('10.99');
  });
  it('converts 0-decimal minor units to string', () => {
    expect(toDecimalString(m(1500), 0)).toBe('1500');
  });
  it('pads fractional part', () => {
    expect(toDecimalString(m(105), 2)).toBe('1.05');
  });
});

describe('isValidMinorAmount', () => {
  it('accepts positive integers', () => {
    expect(isValidMinorAmount(1)).toBe(true);
    expect(isValidMinorAmount(999999)).toBe(true);
  });
  it('rejects 0', () => {
    expect(isValidMinorAmount(0)).toBe(false);
  });
  it('rejects floats', () => {
    expect(isValidMinorAmount(1.5)).toBe(false);
  });
  it('rejects non-numbers', () => {
    expect(isValidMinorAmount('100')).toBe(false);
  });
});

describe('formatCurrency', () => {
  it('formats ARS with 2 decimal places', () => {
    const result = formatCurrency(m(1099), 'ARS', 2, 'es-AR');
    expect(result).toContain('10');
    expect(result).toContain('99');
  });
  it('formats JPY with 0 decimal places', () => {
    const result = formatCurrency(m(1500), 'JPY', 0, 'ja-JP');
    expect(result).toContain('1');
    expect(result).toContain('500');
  });
});
