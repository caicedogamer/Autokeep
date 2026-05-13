/*
 * AiService — facade for suggestion and inconsistency detection (US6).
 *
 * SC-009: when aiEnabled=false, every public method short-circuits to
 * null / [] without touching storage or running heuristics.
 * Constitution Principle II: no DOM here; only domain calls + callbacks.
 */

import type { FinancialRecord } from '../../records/domain/types.js';
import type { AiSettings, InconsistencyFinding, Suggestion } from '../domain/types.js';
import { DEFAULT_AI_SETTINGS } from '../domain/types.js';
import { suggestCategory } from '../domain/suggest.js';
import {
  detectCategoryMismatch,
  detectAmountOutlier,
  detectLikelyDuplicate,
} from '../domain/detect.js';

export interface AiServiceDeps {
  readonly settings?: Partial<AiSettings>;
  readonly persistFindings: (findings: InconsistencyFinding[]) => Promise<void>;
}

export class AiService {
  private readonly settings: AiSettings;
  private readonly persistFindings: AiServiceDeps['persistFindings'];

  public constructor(deps: AiServiceDeps) {
    this.settings = { ...DEFAULT_AI_SETTINGS, ...deps.settings };
    this.persistFindings = deps.persistFindings;
  }

  /** Returns a suggestion for the draft, or null if disabled / below threshold. */
  public suggestForDraft(
    draft: Partial<FinancialRecord>,
    history: readonly FinancialRecord[],
  ): Suggestion | null {
    if (!this.settings.aiEnabled) return null;
    return suggestCategory(draft, history, this.settings);
  }

  /**
   * Runs all three detectors over the full records snapshot.
   * Persists the combined findings and returns them.
   * Short-circuits to [] when aiEnabled=false (SC-009).
   */
  public async runInconsistenciesPass(
    records: readonly FinancialRecord[],
  ): Promise<InconsistencyFinding[]> {
    if (!this.settings.aiEnabled) return [];

    const findings: InconsistencyFinding[] = [
      ...detectCategoryMismatch(records),
      ...detectAmountOutlier(records),
      ...detectLikelyDuplicate(records),
    ];

    await this.persistFindings(findings);
    return findings;
  }

  public getSettings(): AiSettings {
    return this.settings;
  }
}
