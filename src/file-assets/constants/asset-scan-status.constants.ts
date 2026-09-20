import { FileAssetState } from '../enums/file-asset-state.enum';

/**
 * What an uploader is told about their file.
 *
 * Five words, against the registry's ten states. The difference is not
 * laziness: the registry distinguishes a transient fault from a refusal and a
 * withdrawal from a deletion because an administrator and a rescan campaign
 * need those apart, and a person who has just uploaded a portrait needs to
 * know whether to wait, whether it worked, and whether to try something else.
 *
 * This is also the whole of what the status endpoint discloses. There is no
 * rejection code here, no signature, no engine name and no object key,
 * which is how the fourth acceptance criterion is met: not by remembering to
 * omit them at each site, but by there being nothing else to send.
 */
export const ASSET_SCAN_STATUSES = [
  'UPLOADING',
  'AWAITING_SCAN',
  'SCANNING',
  'AVAILABLE',
  'REJECTED',
] as const;

/** How far along an uploaded file is, as its uploader is told it. */
export type AssetScanStatus = (typeof ASSET_SCAN_STATUSES)[number];

/**
 * Which of the five each registry state is reported as.
 *
 * Three of these are judgement calls and are worth stating.
 *
 * **`CLEAN` reads as `SCANNING`.** The scanner has finished and the picture
 * is not in use yet, which is not one of the five words. Of the ones
 * available it is the only one that means "still working, nothing is wrong",
 * and the state normally lasts a second or two.
 *
 * **`RETRY_PENDING` reads as `AWAITING_SCAN`.** From the outside it is
 * indistinguishable from waiting, and it is: something at our end did not
 * answer and will be asked again. Calling it a failure would be wrong, since
 * the file is fine and nobody has said otherwise.
 *
 * **`REVOKED` and `DELETED` read as `REJECTED`.** Neither should reach this
 * mapping during an upload, but if one does, the honest answer to "is my
 * picture in use" is no. The copy the reader sees says the file was not
 * accepted and says nothing about why, which is true of all three.
 */
export const ASSET_SCAN_STATUS_BY_STATE: Readonly<
  Record<FileAssetState, AssetScanStatus>
> = {
  [FileAssetState.UNVERIFIED]: 'AVAILABLE',
  [FileAssetState.RECEIVING]: 'UPLOADING',
  [FileAssetState.QUARANTINED]: 'AWAITING_SCAN',
  [FileAssetState.SCANNING]: 'SCANNING',
  [FileAssetState.CLEAN]: 'SCANNING',
  [FileAssetState.RETRY_PENDING]: 'AWAITING_SCAN',
  [FileAssetState.AVAILABLE]: 'AVAILABLE',
  [FileAssetState.REJECTED]: 'REJECTED',
  [FileAssetState.REVOKED]: 'REJECTED',
  [FileAssetState.DELETED]: 'REJECTED',
};

/**
 * Reports how an asset's state is described to the person who uploaded it.
 *
 * @param state - The registry state.
 * @returns One of the five words an uploader is shown.
 */
export function assetScanStatusOf(state: FileAssetState): AssetScanStatus {
  return ASSET_SCAN_STATUS_BY_STATE[state];
}
