import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Response } from 'express';

import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { Public } from 'src/auth/public.decorator';
import { OptionalUserId } from 'src/auth/user-id.decorator';

import { FileAssetDeliveryService } from './services/file-asset-delivery.service';

/**
 * The only route out of the private bucket.
 *
 * Marked `@Public` and guarded by {@link OptionalJwtAuthGuard} because an
 * asset published to everybody must be readable by a signed-out visitor, while
 * a token is honoured when one is sent. That is not a weakening: the decision
 * is the asset's audience, taken per request against the current row, and
 * "public" is one of the answers it can give rather than a property of the
 * route.
 *
 * Every response carries `no-store`. A private asset that a shared cache kept
 * would be an asset whose withdrawal the next reader never hears about, which
 * is precisely the failure the third acceptance criterion describes. The
 * header is set here rather than trusted to a proxy, because a proxy's
 * configuration is not part of this repository and a cache-control rule that
 * lives somewhere else is a rule that can be changed without anybody reading
 * this file.
 */
@ApiTags('File assets')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard)
@Controller('file-assets')
export class FileAssetDeliveryController {
  /**
   * Creates an instance of FileAssetDeliveryController.
   *
   * @param _deliveryService - Resolves and opens assets for a reader.
   */
  constructor(private readonly _deliveryService: FileAssetDeliveryService) {}

  /**
   * Serves an asset's bytes to a reader entitled to them.
   *
   * @param assetId - The asset asked for.
   * @param viewerId - The authenticated caller's user ID, or null.
   * @param response - Used to set the content and cache headers.
   * @returns The asset's bytes.
   * @throws NotFoundException when the asset does not exist, is not available,
   *   or may not be seen by this reader. All three are the same response.
   */
  @Public()
  @Get(':assetId/content')
  @ApiOperation({ summary: "Serve an available asset's bytes" })
  @ApiOkResponse({ description: 'The asset content.' })
  @ApiNotFoundResponse({
    description:
      'No such asset, the asset is not available, or it may not be seen.',
  })
  async serve(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @OptionalUserId() viewerId: string | null,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const content = await this._deliveryService.openForReader(
      assetId,
      viewerId,
    );

    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Content-Type', content.contentType);
    // Always an attachment, and always with a filename the browser cannot be
    // talked into treating as markup. Rendering a stored file inline would let
    // an upload execute in the site's own origin, which is a cross-site
    // scripting hole wearing an image's content type.
    response.setHeader('Content-Disposition', 'attachment');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (content.byteSize !== null) {
      response.setHeader('Content-Length', String(content.byteSize));
    }

    return new StreamableFile(content.stream);
  }
}
