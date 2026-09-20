import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AssetScanStatusDto } from 'src/file-assets/dto/asset-scan-status.dto';
// Reused rather than restated. How a cropped image and its description are
// parsed off the wire is the same problem here as in Storytime, and a second
// copy of those Multer limits would be a second place for them to drift.
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from 'src/storytime/images/storytime-image-upload.options';

import { CUSTOM_TRACKING_FEATURE_FLAGS } from '../constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from '../custom-tracking-feature.service';
import { CustomTrackingImageAnswerDto } from '../dto/custom-tracking-record.dto';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingValueEditingGuard } from '../values/custom-tracking-value-editing.guard';
import { CustomTrackingImageService } from './custom-tracking-image.service';

/**
 * The picture answering one image Field, for one Account or Character.
 *
 * A picture arrives as an upload and is checked as bytes before anything is
 * stored, which is why it has routes of its own rather than travelling in the
 * record payload: accepting an image identifier in a value would let a caller
 * point a Field at any image in the account.
 */
@ApiTags('Custom Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('custom-tracking')
export class CustomTrackingImagesController {
  /**
   * Creates an instance of CustomTrackingImagesController.
   *
   * @param _images - Storing and removing pictures.
   * @param _features - Whether pictures are switched on.
   */
  constructor(
    private readonly _images: CustomTrackingImageService,
    private readonly _features: CustomTrackingFeatureService,
  ) {}

  /**
   * Stores a picture, replacing any already there.
   *
   * @param userId - The caller.
   * @param fieldId - The image Field being answered.
   * @param scope - Whether an Account or a Character is described.
   * @param targetId - The record described.
   * @param body - The description accompanying the file.
   * @param file - The cropped picture.
   * @returns The upload to ask about, and how far along it is.
   */
  @Post('fields/:fieldId/scopes/:scope/targets/:targetId/image')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CustomTrackingValueEditingGuard)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiOperation({ summary: 'Upload the picture for one field and record' })
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiNotFoundResponse({ description: 'No such field or record of yours.' })
  @ApiBadRequestResponse({
    description:
      'The field takes no picture, the description is missing, or the file is unacceptable.',
  })
  async accept(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    scope: CustomTrackingTargetScope,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() body: { altText?: string },
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AssetScanStatusDto> {
    await this._features.assertFlagEnabled(
      CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED,
    );
    assertImageSupplied(file);

    return this._images.accept({
      userId,
      fieldId,
      scope,
      targetId,
      altText: body?.altText ?? '',
      file,
    });
  }

  /**
   * Reports the picture answering one Field and record.
   *
   * What a dialogue asks once the scanner has cleared its upload. Until
   * then there is nothing to report: the answer row is not written before
   * the picture is published — FC-012.
   *
   * @param userId - The caller.
   * @param fieldId - The image Field.
   * @param scope - Whether an Account or a Character is described.
   * @param targetId - The record described.
   * @returns The picture, or null when there is none.
   */
  @Get('fields/:fieldId/scopes/:scope/targets/:targetId/image')
  @UseGuards(CustomTrackingValueEditingGuard)
  @ApiOperation({ summary: 'Read the picture for one field and record' })
  @ApiOkResponse({ type: CustomTrackingImageAnswerDto })
  @ApiNotFoundResponse({ description: 'No such field or record of yours.' })
  async find(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    scope: CustomTrackingTargetScope,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<CustomTrackingImageAnswerDto | null> {
    await this._features.assertFlagEnabled(
      CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED,
    );

    const stored = await this._images.find(userId, fieldId, scope, targetId);

    if (stored === null) {
      return null;
    }

    return {
      imageId: stored.cloudflareImageId,
      altText: stored.altText,
      shape: stored.shape,
    };
  }

  /**
   * Removes the picture answering one Field and record.
   *
   * @param userId - The caller.
   * @param fieldId - The image Field.
   * @param scope - Whether an Account or a Character is described.
   * @param targetId - The record described.
   */
  @Delete('fields/:fieldId/scopes/:scope/targets/:targetId/image')
  @UseGuards(CustomTrackingValueEditingGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the picture for one field and record' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'There is no picture there.' })
  async remove(
    @UserId() userId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('scope', new ParseEnumPipe(CustomTrackingTargetScope))
    scope: CustomTrackingTargetScope,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<void> {
    await this._features.assertFlagEnabled(
      CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED,
    );
    await this._images.remove(userId, fieldId, scope, targetId);
  }
}
