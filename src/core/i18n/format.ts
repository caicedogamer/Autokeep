/*
 * Locale-aware date and number formatters (FR-039).
 *
 * The locale is injected per call (or via the `withLocale(...)` factory)
 * so callers cannot accidentally couple to a single workspace's setting.
 * `Intl.*` is built into modern browsers per research R11 — no library.
 *
 * `formatAmount` accepts integer minor units (data-model.md convention)
 * and the `currency` + `currencyMinorUnits` from the workspace, and
 * delegates to `Intl.NumberFormat` for locale-correct rendering.
 */

export type BCP47Tag = string; // e.g. 'es', 'es-AR', 'en-US'

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

const getDateTimeFormat = (
  locale: BCP47Tag,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = dateTimeFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatCache.set(key, fmt);
  }
  return fmt;
};

const getNumberFormat = (
  locale: BCP47Tag,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = numberFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, fmt);
  }
  return fmt;
};

/**
 * Formats an `IsoDate` string (`YYYY-MM-DD`) per the locale's medium
 * date style. Time-of-day is intentionally NOT included.
 */
export const formatDate = (isoDate: string, locale: BCP47Tag): string => {
  // Parse as UTC midnight to avoid the operator's local timezone shifting
  // the displayed day for IsoDate values that have no time component.
  const [year, month, day] = isoDate.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    return isoDate;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return getDateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

/**
 * Formats an `IsoDateTime` string per the locale's medium date + short
 * time style.
 */
export const formatDateTime = (isoDateTime: string, locale: BCP47Tag): string => {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return isoDateTime;
  return getDateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

/**
 * Formats a money amount stored in integer minor units.
 *
 * @param amount integer minor units, e.g. `15000` for ARS $150.00 with
 *               `currencyMinorUnits = 2`.
 * @param currency ISO 4217 (3 letters), e.g. `'ARS'`.
 * @param currencyMinorUnits 0 | 2 | 3 — must match the workspace.
 * @param locale BCP-47 locale tag.
 */
export const formatAmount = (
  amount: number,
  currency: string,
  currencyMinorUnits: 0 | 2 | 3,
  locale: BCP47Tag,
): string => {
  const major = amount / 10 ** currencyMinorUnits;
  return getNumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: currencyMinorUnits,
    maximumFractionDigits: currencyMinorUnits,
  }).format(major);
};

/**
 * Formats a unitless decimal number per the locale.
 */
export const formatDecimal = (value: number, locale: BCP47Tag, fractionDigits = 2): string =>
  getNumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

/**
 * For tests / hot-reload: clears the format-instance caches.
 */
export const __resetFormatCaches = (): void => {
  dateTimeFormatCache.clear();
  numberFormatCache.clear();
};
