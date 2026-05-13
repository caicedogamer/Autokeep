/*
 * i18n facade.
 *
 * `t(key, vars?)` is the only public lookup API. The compile-time type
 * of `key` is the union of declared copy keys, so unknown keys fail
 * type-check (FR-038).
 *
 * Variable interpolation uses `{name}` placeholders. Missing variables
 * are left in place to make missing-binding bugs visible during review.
 */
import { es, type CopyKey } from './es.js';

export type LocaleCode = 'es';

let activeBundle: Readonly<Record<CopyKey, string>> = es;
let activeLocale: LocaleCode = 'es';

export const setLocale = (locale: LocaleCode): void => {
  activeLocale = locale;
  switch (locale) {
    case 'es':
      activeBundle = es;
      return;
  }
};

export const getLocale = (): LocaleCode => activeLocale;

export const t = (key: CopyKey, vars?: Readonly<Record<string, string | number>>): string => {
  const template = activeBundle[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
};
