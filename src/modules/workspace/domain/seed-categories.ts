/*
 * Canonical category seed set (research OQ-1).
 * Created once on workspace creation; operator can edit/delete/merge afterward.
 */

import type { Category } from '../../records/domain/types.js';
import { toId, toIsoDateTime } from '../../records/domain/types.js';

const SEED_NAMES = ['Ventas', 'Servicios', 'Sueldos', 'Impuestos', 'Insumos', 'Otros'] as const;

function makeId(idx: number): string {
  return `seed-cat-${String(idx).padStart(3, '0')}`;
}

export function buildSeedCategories(): Category[] {
  const now = toIsoDateTime(new Date().toISOString());
  return SEED_NAMES.map((name, i) => ({
    id: toId(makeId(i + 1)),
    name,
    learnedFromAi: false,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  }));
}
