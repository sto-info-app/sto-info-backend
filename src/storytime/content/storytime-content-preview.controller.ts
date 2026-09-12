import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { ContentPreviewDto } from './dto/content-preview.dto';
import { PreviewContentDto } from './dto/preview-content.dto';
import { StorytimeMarkdownService } from './storytime-markdown.service';

/**
 * Rendering a creator's Markdown before they commit to it.
 *
 * The point of asking the server is fidelity. Storytime's renderer is not a
 * general Markdown implementation — it demotes headings, anchors every block,
 * and drops any link that leaves the site — so a second renderer in the client
 * would eventually show an author a document their readers never see. Rather
 * than keep two implementations honest, the preview comes from the one that
 * will actually produce the saved HTML.
 *
 * Behind sign-in alone rather than a creator permission, for the same reason
 * the Arc controller is: the four fields that take Markdown are not all behind
 * the same permission — an Arc is curated by anybody signed in — and this route
 * reads nothing, writes nothing and returns only the caller's own text back to
 * them. A permission check here would block a curator from previewing the
 * description they are allowed to save.
 *
 * It is a POST because the source is a body rather than a query string: a
 * Chapter runs to a hundred thousand characters and has no business in a URL.
 * Nothing is created, so it answers 200 rather than 201.
 */
@ApiTags('Storytime (creator)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storytime/manage/content')
export class StorytimeContentPreviewController {
  /**
   * Creates an instance of StorytimeContentPreviewController.
   *
   * @param _markdownService - Renders the Markdown.
   * @param _featureService - Reports whether writing is switched on.
   */
  constructor(
    private readonly _markdownService: StorytimeMarkdownService,
    private readonly _featureService: StorytimeFeatureService,
  ) {}

  /**
   * Renders Markdown as a reader will receive it.
   *
   * @param dto - The Markdown to render.
   * @returns The rendered HTML.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Render Storytime Markdown without saving it' })
  @ApiOkResponse({ type: ContentPreviewDto })
  @ApiBadRequestResponse({ description: 'The content is too long.' })
  @ApiNotFoundResponse({ description: 'Writing is switched off.' })
  async preview(@Body() dto: PreviewContentDto): Promise<ContentPreviewDto> {
    await this._featureService.assertFlagEnabled(
      STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
    );

    return { html: this._markdownService.render(dto.contentSource).html };
  }
}
