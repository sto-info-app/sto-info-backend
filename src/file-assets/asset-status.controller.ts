import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';

import { AssetScanStatusDto } from './dto/asset-scan-status.dto';
import { AssetStatusService } from './services/asset-status.service';

/**
 * Where an upload has got to.
 *
 * The one route a page polls while a picture is being scanned, for every
 * upload in the application. One endpoint rather than a state added to ten
 * existing responses: the ten would each need the same five words, the same
 * refusal copy and the same care about what they do not say, and one of them
 * would eventually get it wrong.
 *
 * Signed in, and the uploader's own uploads only. Unlike the delivery route
 * beside it, there is no public reading of this: an anonymous visitor has no
 * upload to ask about.
 */
@ApiTags('File assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('file-assets')
export class AssetStatusController {
  /**
   * Creates an instance of AssetStatusController.
   *
   * @param _status - What reports on an upload.
   */
  constructor(private readonly _status: AssetStatusService) {}

  /**
   * Reports how far along one upload is.
   *
   * @param assetId - The upload asked about.
   * @param viewerId - The authenticated caller.
   * @returns The upload and one of five words.
   * @throws NotFoundException when there is no such upload, or it is not the
   *   caller's. Both are the same response.
   */
  @Get(':assetId/status')
  @ApiOperation({ summary: 'Report how far along an upload is' })
  @ApiOkResponse({ type: AssetScanStatusDto })
  @ApiNotFoundResponse({
    description: 'No such upload, or it is not the caller.',
  })
  async status(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @UserId() viewerId: string,
  ): Promise<AssetScanStatusDto> {
    return this._status.report(assetId, viewerId);
  }
}
