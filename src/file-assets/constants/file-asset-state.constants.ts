import { FileAssetState } from '../enums/file-asset-state.enum';

/**
 * Which state an asset may move to from the one it is in.
 *
 * Three properties are worth stating, because each of them is load-bearing.
 *
 * **Nothing goes backwards.** Every transition moves toward a terminal state.
 * There is no path from `REJECTED` or `REVOKED` back to `AVAILABLE`, so bytes
 * that were once refused cannot be published by any sequence of writes.
 * Replacing them means registering a new asset, which is what makes a
 * replacement invalidate the prior verdict rather than inherit it.
 *
 * **A rescan does not appear here.** Scanning an asset that is already
 * published records an attempt against it and then either leaves the state
 * alone or moves it to `REVOKED`. Putting a live asset back into `SCANNING`
 * would take every profile picture off the site for the length of an estate
 * campaign, which is a fail-closed rule applied to the wrong question: the
 * bytes have already been served, and the honest response to a suspicion about
 * them is to finish looking, not to hide them in the meanwhile.
 *
 * **`AVAILABLE` has exactly two doors.** `CLEAN`, which is a scanner verdict
 * followed by a publication decision, and `UNVERIFIED`, which is the backfill
 * of bytes the site has been serving for years. The second exists only until
 * W10's campaigns have emptied it, and it goes straight to `AVAILABLE` rather
 * than through `CLEAN` because there is no publication decision left to make —
 * that was made, by somebody, long ago.
 */
export const FILE_ASSET_TRANSITIONS: Readonly<
  Record<FileAssetState, readonly FileAssetState[]>
> = {
  [FileAssetState.UNVERIFIED]: [
    FileAssetState.QUARANTINED,
    FileAssetState.AVAILABLE,
    FileAssetState.REVOKED,
    FileAssetState.DELETED,
  ],
  [FileAssetState.RECEIVING]: [
    FileAssetState.QUARANTINED,
    FileAssetState.REJECTED,
    FileAssetState.DELETED,
  ],
  [FileAssetState.QUARANTINED]: [
    FileAssetState.SCANNING,
    FileAssetState.RETRY_PENDING,
    FileAssetState.REJECTED,
    FileAssetState.DELETED,
  ],
  [FileAssetState.SCANNING]: [
    FileAssetState.CLEAN,
    FileAssetState.RETRY_PENDING,
    FileAssetState.REJECTED,
    FileAssetState.DELETED,
  ],
  [FileAssetState.RETRY_PENDING]: [
    FileAssetState.SCANNING,
    FileAssetState.REJECTED,
    FileAssetState.DELETED,
  ],
  [FileAssetState.CLEAN]: [
    FileAssetState.AVAILABLE,
    FileAssetState.REJECTED,
    FileAssetState.DELETED,
  ],
  [FileAssetState.AVAILABLE]: [FileAssetState.REVOKED, FileAssetState.DELETED],
  [FileAssetState.REJECTED]: [FileAssetState.DELETED],
  [FileAssetState.REVOKED]: [FileAssetState.DELETED],
  [FileAssetState.DELETED]: [],
};

/**
 * The state a newly registered asset starts in.
 *
 * `RECEIVING` and not `QUARANTINED`: a row is written before the bytes are in
 * the bucket, so that an upload interrupted halfway leaves a record of an
 * object that may exist rather than no record at all. An orphaned object with
 * no row is the one thing a rescan campaign cannot find.
 */
export const INITIAL_FILE_ASSET_STATE = FileAssetState.RECEIVING;

/**
 * Reports whether an asset may move from one state to another.
 *
 * @param from - The state the asset is in.
 * @param to - The state it would move to.
 * @returns True when the move is allowed.
 */
export function canTransitionFileAsset(
  from: FileAssetState,
  to: FileAssetState,
): boolean {
  return FILE_ASSET_TRANSITIONS[from].includes(to);
}
