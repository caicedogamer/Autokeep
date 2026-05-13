/*
 * StorageAdapter key helpers for the `workspace` module.
 *
 * All keys live under the `autokeep:` namespace per
 * specs/001-autokeep-mvp/contracts/storage-adapter.md. Centralising key
 * construction in one file ensures consumers cannot drift on naming.
 */

export const WORKSPACE_KEY_NAMESPACE = 'autokeep:';

const requireWorkspaceId = (id: string): string => {
  if (!id || /[^a-zA-Z0-9-]/.test(id)) {
    throw new Error(`Invalid workspaceId: ${JSON.stringify(id)}`);
  }
  return id;
};

/** Encrypted workspace payload (the data-model.md `WorkspacePayloadV1`). */
export const workspaceBlobKey = (id: string): string =>
  `${WORKSPACE_KEY_NAMESPACE}ws:${requireWorkspaceId(id)}`;

/** Non-secret metadata: `{ kdf, schemaVersion }`. Read before unlock. */
export const workspaceMetaKey = (id: string): string =>
  `${WORKSPACE_KEY_NAMESPACE}ws:${requireWorkspaceId(id)}:meta`;

/** Brute-force throttle counter for the unlock UI (research R6). */
export const workspaceThrottleKey = (id: string): string =>
  `${WORKSPACE_KEY_NAMESPACE}ws:${requireWorkspaceId(id)}:throttle`;

/** Index of all workspaces present on this device (id, name, lastOpenedAt). */
export const workspacesIndexKey = (): string => `${WORKSPACE_KEY_NAMESPACE}workspaces`;

/** True iff a key belongs to AutoKeep's namespace. */
export const isAutoKeepKey = (key: string): boolean => key.startsWith(WORKSPACE_KEY_NAMESPACE);
