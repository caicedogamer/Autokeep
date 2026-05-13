/*
 * CrossTabWatcher — listens for storage-change events emitted by
 * LocalStorageAdapter and triggers a callback when the workspace blob is
 * modified by another tab.
 *
 * The callback receives the affected key so consumers can decide whether to
 * reload their in-memory snapshot (and surface the conflict dialog if they
 * have an unsaved draft).
 *
 * This is intentionally thin — it delegates cross-tab signalling to the
 * storage adapter's `onChange` mechanism rather than duplicating it.
 */

import type { StorageAdapter } from '../../../core/storage/storage-adapter.js';
import { workspaceBlobKey } from '../../workspace/domain/keys.js';

export type CrossTabChangeCallback = (workspaceId: string) => void;

export class CrossTabWatcher {
  private readonly unsubscribe: () => void;

  /**
   * @param adapter   The StorageAdapter for the active workspace.
   * @param workspaceId  The workspace whose blob key we watch.
   * @param onRemoteChange  Called when another tab writes to the blob.
   */
  public constructor(
    adapter: StorageAdapter,
    workspaceId: string,
    onRemoteChange: CrossTabChangeCallback,
  ) {
    const targetKey = workspaceBlobKey(workspaceId);

    this.unsubscribe = adapter.subscribe(targetKey, () => {
      onRemoteChange(workspaceId);
    });
  }

  /** Stop listening. Call when the workspace is locked or the UI unmounts. */
  public dispose(): void {
    this.unsubscribe();
  }
}
