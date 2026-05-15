/*
 * Inference heuristics (Stage 2) — flexible import pipeline.
 *
 * Spec refs:
 *   - contracts/import-csv.schema.md §Stage 2
 *   - contracts/import-mapping.md
 *   - research.md R15 (heuristic-only, no fuzzy-match lib)
 *
 * Pure functions, deterministic for a given (RawTable, InferenceContext).
 *
 * The header-regex table is bilingual (es / en). The value-pattern
 * detectors run on a bounded sample (≤ 200 rows) per the contract.
 */

import type {
  AlternativeRole,
  ColumnInference,
  InferredType,
  RawTable,
  SemanticRole,
} from '../types.js';

/* ---------- Header → role regex ---------- */

/**
 * Each entry produces a `headerScore` ∈ [0, 1]:
 *   1.0  whole-header exact match (case-insensitive)
 *   0.85 substring match against the pattern
 *   0    no match
 */
interface HeaderPattern {
  readonly role: SemanticRole;
  readonly pattern: RegExp;
}

const HEADER_PATTERNS: readonly HeaderPattern[] = [
  // date
  {
    role: 'date',
    pattern: /^(date|fecha|d[íi]a|day|fechaop|fecha[_\s-]?op|trans.*date|posting[_\s-]?date)$/i,
  },
  // amount
  {
    role: 'amount',
    pattern: /(amount|monto|importe|total|valor|debit|credit|d[ée]bito|cr[ée]dito|haber|debe)/i,
  },
  // type
  { role: 'type', pattern: /^(type|tipo|sign|mov|movimiento|operaci[oó]n)$/i },
  // category
  { role: 'category', pattern: /(categor[ií]a|category|clase|class|rubro)/i },
  // description
  { role: 'description', pattern: /(desc|detalle|concepto|memo|notes?|observ)/i },
  // counterparty
  {
    role: 'counterparty',
    pattern:
      /(counterparty|party|client(e)?|cliente|supplier|proveedor|provider|tercero|beneficiari[oa]|empresa)/i,
  },
  // currency
  { role: 'currency', pattern: /(currency|curr|moneda|coin|divisa)/i },
];

function headerScore(header: string, pattern: RegExp): number {
  const normalized = header.trim();
  if (!normalized) return 0;
  // Try exact match first (anchored).
  if (pattern.source.startsWith('^') && pattern.test(normalized)) return 1.0;
  if (pattern.test(normalized)) return 0.85;
  return 0;
}

/* ---------- Value-pattern type detection ---------- */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DDMM_DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
const NUMBER_RE = /^-?\d{1,3}(?:[.,\s]?\d{3})*(?:[.,]\d+)?$|^-?\d+([.,]\d+)?$/;
const BOOLEAN_RE = /^(true|false|0|1|yes|no|sí|si)$/i;
const CURRENCY_ISO_RE = /^[A-Z]{3}$/;

const INCOME_VOCAB = new Set(['income', 'ingreso', 'ingresos', 'credit', 'cr', 'haber', '+']);
const EXPENSE_VOCAB = new Set([
  'expense',
  'egreso',
  'egresos',
  'gasto',
  'gastos',
  'debit',
  'db',
  'debe',
  '-',
]);

export function detectCellType(value: string): InferredType {
  const trimmed = value.trim();
  if (!trimmed) return 'string';
  if (ISO_DATE_RE.test(trimmed) || DDMM_DATE_RE.test(trimmed)) return 'date';
  if (NUMBER_RE.test(trimmed)) return 'number';
  if (BOOLEAN_RE.test(trimmed)) return 'boolean';
  return 'string';
}

/**
 * Dominant type across non-empty sample values.
 * Returns the type AND the mismatch rate (share of cells that did NOT
 * match the dominant type).
 */
export function dominantType(values: readonly string[]): {
  type: InferredType;
  mismatchRate: number;
  sampleSize: number;
} {
  const nonEmpty = values.filter((v) => v.trim().length > 0);
  const sampleSize = nonEmpty.length;
  if (sampleSize === 0) return { type: 'string', mismatchRate: 0, sampleSize: 0 };

  const counts: Record<InferredType, number> = {
    string: 0,
    number: 0,
    date: 0,
    enum: 0,
    boolean: 0,
  };
  for (const v of nonEmpty) {
    counts[detectCellType(v)] += 1;
  }

  // First, pick the unpromoted dominant from observed cell types.
  let dominant: InferredType = 'string';
  let dominantCount = 0;
  for (const [type, count] of Object.entries(counts) as Array<[InferredType, number]>) {
    if (count > dominantCount) {
      dominant = type;
      dominantCount = count;
    }
  }
  const mismatchRate = (sampleSize - dominantCount) / sampleSize;

  // Promote string → enum when ≤ 10 distinct case-folded short values
  // and every value is short (≤ 30 chars). Never promote a numeric or
  // date column to enum — those would lose semantic precision.
  if (dominant === 'string') {
    const distinct = new Set(nonEmpty.map((v) => v.trim().toLowerCase()));
    const allShort = nonEmpty.every((v) => v.trim().length <= 30);
    if (distinct.size <= 10 && allShort) {
      return { type: 'enum', mismatchRate: 0, sampleSize };
    }
  }

  return { type: dominant, mismatchRate, sampleSize };
}

/* ---------- Value score per (role, column) ---------- */

/**
 * `valueScore` ∈ [0, 1]: how strongly the sampled values support the role.
 */
function valueScoreFor(role: SemanticRole, type: InferredType, values: readonly string[]): number {
  const nonEmpty = values.filter((v) => v.trim().length > 0);
  if (nonEmpty.length === 0) return 0;

  switch (role) {
    case 'date':
      return type === 'date' ? 1.0 : 0;
    case 'amount':
      return type === 'number' ? 0.9 : 0;
    case 'type': {
      // Strong: enum of {income, expense, …}
      const lc = nonEmpty.map((v) => v.trim().toLowerCase());
      const matches = lc.filter((v) => INCOME_VOCAB.has(v) || EXPENSE_VOCAB.has(v)).length;
      return matches / lc.length;
    }
    case 'currency': {
      const matches = nonEmpty.filter((v) => CURRENCY_ISO_RE.test(v.trim())).length;
      return matches / nonEmpty.length;
    }
    case 'category':
      return type === 'string' || type === 'enum' ? 0.55 : 0;
    case 'description': {
      // Mean length ≥ 8 chars suggests description.
      const meanLen = nonEmpty.reduce((sum, v) => sum + v.trim().length, 0) / nonEmpty.length;
      return type === 'string' && meanLen >= 8 ? 0.7 : type === 'string' ? 0.35 : 0;
    }
    case 'counterparty':
      return type === 'string' ? 0.5 : 0;
    case 'metadata':
    case 'ignore':
      return 0;
  }
}

/* ---------- Per-column inference ---------- */

const DEFAULT_SAMPLE = 200;

export interface InferColumnOptions {
  readonly sampleSizeLimit?: number;
  /** Optional native-type hint per column from a JSON source. */
  readonly nativeType?: 'string' | 'number' | 'boolean' | 'null' | 'mixed';
}

/**
 * Score every role for one column and return an ordered ColumnInference
 * with `inferredRole = top role`, the top 2 alternatives, and the
 * composite confidence.
 */
export function inferColumn(
  table: RawTable,
  columnIndex: number,
  options: InferColumnOptions = {},
): ColumnInference {
  const limit = options.sampleSizeLimit ?? DEFAULT_SAMPLE;
  const header = table.headers[columnIndex] ?? `col_${String(columnIndex + 1)}`;
  const values: string[] = [];
  for (let i = 0; i < Math.min(table.rows.length, limit); i++) {
    const row = table.rows[i];
    if (row && columnIndex < row.length) values.push(row[columnIndex] ?? '');
  }

  // Type detection.
  const detected = dominantType(values);
  const { mismatchRate, sampleSize } = detected;
  let inferredType = detected.type;

  // JSON native-type override: a column whose source values were always
  // `number` is more confidently a `number` regardless of how the
  // stringified form parses (e.g. integer-only minor-units).
  if (options.nativeType === 'number') inferredType = 'number';
  else if (options.nativeType === 'boolean') inferredType = 'boolean';

  // Score each role.
  type RoleScore = { role: SemanticRole; score: number };
  const scores: RoleScore[] = [];
  for (const { role, pattern } of HEADER_PATTERNS) {
    const hs = headerScore(header, pattern);
    const vs = valueScoreFor(role, inferredType, values);
    const composite = 0.6 * hs + 0.4 * vs;
    if (composite > 0) {
      scores.push({ role, score: composite });
    }
  }

  // Deterministic tie-break: by role priority then index.
  const rolePriority: SemanticRole[] = [
    'date',
    'amount',
    'type',
    'category',
    'description',
    'counterparty',
    'currency',
  ];
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return rolePriority.indexOf(a.role) - rolePriority.indexOf(b.role);
  });

  // If nothing scored, default to metadata with 0 confidence.
  const top = scores[0];
  let inferredRole: SemanticRole;
  let confidence: number;
  if (!top) {
    inferredRole = 'metadata';
    confidence = 0;
  } else {
    inferredRole = top.role;
    confidence = clamp(top.score);
  }

  const alternativeRoles: AlternativeRole[] = scores
    .slice(1, 3)
    .map((s) => ({ role: s.role, confidence: clamp(s.score) }));

  return {
    columnIndex,
    header,
    inferredType,
    inferredRole,
    confidence,
    alternativeRoles,
    sampleSize,
    mismatchRate,
  };
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/* ---------- Format ambiguity detection ---------- */

/**
 * For a column where `inferredRole === 'date'`, return the candidate
 * date-format set inferred from sample values, OR a single resolved
 * format. Used to populate `MappingDecision.dateFormatPerColumn` and
 * `AMBIGUOUS_DATE_FORMAT` warnings.
 */
export function inferDateFormats(
  values: readonly string[],
): ReadonlyArray<'iso' | 'dd-mm-yyyy' | 'mm-dd-yyyy'> {
  const nonEmpty = values.filter((v) => v.trim().length > 0).slice(0, 200);
  if (nonEmpty.length === 0) return [];

  let isoCount = 0;
  let ddmmDecisive = 0;
  let mmddDecisive = 0;
  let ambiguous = 0;

  for (const v of nonEmpty) {
    const t = v.trim();
    if (ISO_DATE_RE.test(t)) {
      isoCount += 1;
      continue;
    }
    const m = /^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}$/.exec(t);
    if (!m) continue;
    const a = parseInt(m[1] ?? '0', 10);
    const b = parseInt(m[2] ?? '0', 10);
    if (a > 12 && b <= 12) ddmmDecisive += 1;
    else if (b > 12 && a <= 12) mmddDecisive += 1;
    else ambiguous += 1;
  }

  if (isoCount > 0 && ddmmDecisive === 0 && mmddDecisive === 0 && ambiguous === 0) return ['iso'];
  if (ddmmDecisive > 0 && mmddDecisive === 0) return ['dd-mm-yyyy'];
  if (mmddDecisive > 0 && ddmmDecisive === 0) return ['mm-dd-yyyy'];
  if (ddmmDecisive > 0 && mmddDecisive > 0) return ['dd-mm-yyyy', 'mm-dd-yyyy'];
  if (ambiguous > 0 && isoCount === 0) return ['dd-mm-yyyy', 'mm-dd-yyyy'];
  // Mix of ISO + slash with no decisive marker.
  if (isoCount > 0 && (ambiguous > 0 || ddmmDecisive === 0)) return ['iso'];
  return ['iso'];
}

export function inferDecimalSeparator(values: readonly string[]): ReadonlyArray<'.' | ','> {
  const nonEmpty = values.filter((v) => v.trim().length > 0).slice(0, 200);
  if (nonEmpty.length === 0) return [];
  let dot = 0;
  let comma = 0;
  for (const v of nonEmpty) {
    const t = v.trim();
    const hasDot = /\.\d/.test(t);
    const hasComma = /,\d/.test(t);
    if (hasDot && !hasComma) dot += 1;
    else if (hasComma && !hasDot) comma += 1;
    // both present: assume European format (1.234,56) → ','
    else if (hasComma && hasDot) comma += 1;
  }
  if (dot > 0 && comma === 0) return ['.'];
  if (comma > 0 && dot === 0) return [','];
  if (dot > 0 && comma > 0) return ['.', ','];
  // No decimals seen — neither candidate is needed; default to '.'.
  return ['.'];
}

/**
 * For a JSON `amount` column whose values were `number` natively, the
 * inferrer cannot tell minor-units vs major-decimal from the values
 * alone. Returns the candidates the operator must pick from.
 */
export function inferAmountConvention(
  values: readonly string[],
  nativeType: 'string' | 'number' | 'boolean' | 'null' | 'mixed' | undefined,
): ReadonlyArray<'minor-units' | 'major-decimal'> {
  if (nativeType !== 'number') return ['major-decimal'];
  const nonEmpty = values.filter((v) => v.trim().length > 0).slice(0, 200);
  if (nonEmpty.length === 0) return ['major-decimal'];
  const allInteger = nonEmpty.every((v) => /^-?\d+$/.test(v.trim()));
  if (allInteger) return ['minor-units', 'major-decimal'];
  return ['major-decimal'];
}
