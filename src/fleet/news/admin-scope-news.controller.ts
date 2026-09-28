import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetFeatureService } from '../fleet-feature.service';
import { ScopeNewsService } from './services/scope-news.service';

/**
 * Site administrators taking a Community's, a Fleet's or an Armada's news
 * post down (FC-027).
 *
 * Steve's decision of 28 September 2026: a site administrator may unpublish
 * or delete any scoped post, whatever the state of its scope, but writes one
 * only by holding `news.write` there like anybody else. The site's own news
 * stays theirs alone, through the site's news routes, which never reach a
 * scoped post.
 */
@ApiTags('Fleet news (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/fleet-news')
export class AdminScopeNewsController {
  /**
   * Creates an instance of AdminScopeNewsController.
   *
   * @param _featureService - Reports whether the Fleet feature is on.
   * @param _news - Reads and writes scoped news.
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _news: ScopeNewsService,
  ) {}

  /**
   * Takes a scoped post back to a draft.
   *
   * @param postId - The post.
   */
  @Post(':postId/unpublish')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unpublish a Fleet news post (admin)' })
  @ApiNoContentResponse({ description: 'Unpublished.' })
  @ApiForbiddenResponse({ description: 'Not a site administrator.' })
  @ApiNotFoundResponse({ description: 'No such scoped post.' })
  async unpublish(
    @Param('postId', ParseUUIDPipe) postId: string,
  ): Promise<void> {
    await this._featureService.assertEnabled();
    await this._news.unpublishAsSiteAdmin(postId);
  }

  /**
   * Deletes a scoped post.
   *
   * @param postId - The post.
   */
  @Delete(':postId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Fleet news post (admin)' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiForbiddenResponse({ description: 'Not a site administrator.' })
  @ApiNotFoundResponse({ description: 'No such scoped post.' })
  async remove(@Param('postId', ParseUUIDPipe) postId: string): Promise<void> {
    await this._featureService.assertEnabled();
    await this._news.removeAsSiteAdmin(postId);
  }
}
