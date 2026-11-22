import { ApiProperty } from '@nestjs/swagger';

import {
  ASSET_SCAN_STATUSES,
  AssetScanStatus,
} from '../constants/asset-scan-status.constants';

/**
 * What an upload endpoint answers, and what polling it returns.
 *
 * Two fields, and the shortness is the point. An upload used to answer with
 * the record it had just changed; it now answers with a thing to ask about
 * and how far along it is, because nothing has changed yet and saying
 * otherwise would be a lie the page would then have to draw.
 */
export class AssetScanStatusDto {
  @ApiProperty({ description: 'The upload to ask about.', format: 'uuid' })
  assetId: string;

  @ApiProperty({
    description: 'How far along the upload is.',
    enum: ASSET_SCAN_STATUSES,
  })
  status: AssetScanStatus;
}
