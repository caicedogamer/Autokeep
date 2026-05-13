/*
 * Public surface of the workspace module.
 * Barrel re-exports — no side effects on import.
 */

// Domain
export {
  workspaceBlobKey,
  workspaceMetaKey,
  workspaceThrottleKey,
  workspacesIndexKey,
  isAutoKeepKey,
  WORKSPACE_KEY_NAMESPACE,
} from './domain/keys.js';

// Services
export {
  WorkspaceService,
  WorkspaceNotFoundError,
  WorkspaceUnlockFailedError,
} from './services/workspace-service.js';
export type {
  WorkspaceMeta,
  WorkspaceIndexEntry,
  WorkspacesIndex,
  Workspace,
  WorkspacePayloadV1,
  WorkspaceServiceDeps,
  UnlockedWorkspace,
  CreateWorkspaceInput,
} from './services/workspace-service.js';

export { UnlockThrottle } from './services/unlock-throttle.js';

export {
  evaluateCapacity,
  wouldExceedHardCap,
  remainingCapacity,
  CapacityExceededError,
  CAPACITY_SOFT_WARNING_THRESHOLD,
  CAPACITY_HARD_CAP,
} from './services/capacity-gate.js';

// UI
export { SetupScreen } from './ui/setup-screen.js';
export { UnlockScreen } from './ui/unlock-screen.js';
export { ChangePassphraseScreen } from './ui/change-passphrase-screen.js';
export { PrivacySummary } from './ui/privacy-summary.js';
