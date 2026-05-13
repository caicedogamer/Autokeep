/*
 * Zod validation schemas for domain entities and value objects.
 * Used at import boundaries and for workspace payload validation.
 */

import { z } from 'zod';

/* ---------- Primitives ---------- */

export const IdSchema = z.string().uuid();

// ISO-8601 date: YYYY-MM-DD
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid calendar date');

// ISO-8601 UTC datetime: ends in Z
export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'Expected ISO-8601 UTC');

// Positive integer in minor units
export const MoneyMinorSchema = z
  .number()
  .int('Amount must be an integer')
  .positive('Amount must be > 0');

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Expected ISO 4217 currency code');

export const BCP47TagSchema = z.string().min(2).max(35);

/* ---------- FinancialRecord ---------- */

export const FinancialRecordSchema = z.object({
  id: IdSchema,
  date: IsoDateSchema,
  type: z.enum(['income', 'expense']),
  amount: MoneyMinorSchema,
  categoryId: IdSchema,
  description: z
    .string()
    .min(1, 'Description required')
    .max(280)
    .transform((s) => s.trim()),
  counterpartyId: IdSchema.optional(),
  source: z.enum(['manual', 'import']),
  importBatchId: IdSchema.optional(),
  version: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  schemaVersion: z.literal(1),
});

export type FinancialRecordRaw = z.input<typeof FinancialRecordSchema>;

/* ---------- Category ---------- */

export const CategorySchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1, 'Category name required')
    .max(60)
    .transform((s) => s.trim()),
  parentId: IdSchema.optional(),
  learnedFromAi: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  schemaVersion: z.literal(1),
});

/* ---------- Counterparty ---------- */

const AliasSchema = z
  .string()
  .min(1)
  .max(120)
  .transform((s) => s.trim());

export const CounterpartySchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1, 'Counterparty name required')
    .max(120)
    .transform((s) => s.trim()),
  aliases: z.array(AliasSchema).max(10),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  schemaVersion: z.literal(1),
});

/* ---------- FilterState ---------- */

export const FilterStateSchema = z.object({
  query: z.string(),
  dateFrom: IsoDateSchema.nullable(),
  dateTo: IsoDateSchema.nullable(),
  types: z.array(z.enum(['income', 'expense'])),
  categoryIds: z.array(IdSchema),
  counterpartyIds: z.array(IdSchema),
  amountMin: MoneyMinorSchema.nullable(),
  amountMax: MoneyMinorSchema.nullable(),
});

/* ---------- Input schemas (for domain boundaries) ---------- */

export const NewRecordInputSchema = z.object({
  date: IsoDateSchema,
  type: z.enum(['income', 'expense']),
  amount: MoneyMinorSchema,
  categoryId: IdSchema,
  description: z
    .string()
    .min(1, 'Description required')
    .max(280)
    .transform((s) => s.trim()),
  counterpartyId: IdSchema.optional(),
});

export const UpdateRecordInputSchema = z.object({
  id: IdSchema,
  version: z.number().int().positive(),
  date: IsoDateSchema.optional(),
  type: z.enum(['income', 'expense']).optional(),
  amount: MoneyMinorSchema.optional(),
  categoryId: IdSchema.optional(),
  description: z
    .string()
    .min(1)
    .max(280)
    .transform((s) => s.trim())
    .optional(),
  counterpartyId: IdSchema.nullable().optional(),
});
