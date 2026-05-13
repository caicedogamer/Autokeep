/*
 * Public surface of the `ai` module (US6).
 */

export { AiService } from './services/ai-service.js';
export type { AiServiceDeps } from './services/ai-service.js';
export type {
  Suggestion,
  SuggestionBasisEntry,
  InconsistencyFinding,
  InconsistencyKind,
  InconsistencyStatus,
  AiSettings,
} from './domain/types.js';
export { DEFAULT_AI_SETTINGS, confidenceLabel } from './domain/types.js';
export { suggestCategory } from './domain/suggest.js';
export {
  detectCategoryMismatch,
  detectAmountOutlier,
  detectLikelyDuplicate,
} from './domain/detect.js';
export { SuggestionChip } from './ui/suggestion-chip.js';
export type { SuggestionChipOpts } from './ui/suggestion-chip.js';
export { InconsistenciesView } from './ui/inconsistencies-view.js';
export type { InconsistenciesViewOpts } from './ui/inconsistencies-view.js';
export { AiSettingsPanel } from './ui/ai-settings.js';
export type { AiSettingsOpts } from './ui/ai-settings.js';

export const AI_EVENTS = {
  SUGGESTION_ACCEPTED: 'ai:suggestion-accepted',
  SUGGESTION_DISMISSED: 'ai:suggestion-dismissed',
  INCONSISTENCIES_UPDATED: 'ai:inconsistencies-updated',
} as const;
