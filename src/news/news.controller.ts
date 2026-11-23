import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
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
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Public } from 'src/auth/public.decorator';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AssetScanStatusDto } from 'src/file-assets/dto/asset-scan-status.dto';
import { FleetImageUploadDto } from 'src/fleet/dto/fleet-image-upload.dto';
import { FileSizeExceptionFilter } from 'src/shared/filters/file-size-exception.filter';
import {
  assertImageSupplied,
  STORYTIME_IMAGE_FIELD,
  STORYTIME_IMAGE_UPLOAD_OPTIONS,
  STORYTIME_IMAGE_UPLOAD_SCHEMA,
} from 'src/storytime/images/storytime-image-upload.options';
import { UserRole } from 'src/user/enums/user-role.enum';

import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { NewsQueryDto } from './dto/news-query.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';
import {
  NewsPageView,
  newsPageView,
  NewsPostView,
  newsPostView,
} from './news-post.view';
import { NewsService, PaginatedNews, PublishedNewsPost } from './news.service';

@ApiTags('News')
@Controller('news')
export class NewsController {
  /**
   * Creates an instance of NewsController.
   *
   * @param _newsService - The news service.
   */
  constructor(private readonly _newsService: NewsService) {}

  /**
   * Lists published news posts (public).
   *
   * @param query - Pagination and category filter.
   * @returns A page of published posts.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'List published news posts' })
  @ApiOkResponse({ description: 'A page of published posts.' })
  async findPublished(
    @Query() query: NewsQueryDto,
  ): Promise<NewsPageView<PaginatedNews>> {
    return newsPageView(await this._newsService.findPublished(query));
  }

  /**
   * Lists all posts including drafts (admin only).
   *
   * @param query - Pagination and category filter.
   * @returns A page of posts.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin')
  @ApiOperation({ summary: 'List all news posts (admin)' })
  async findAllForAdmin(
    @Query() query: NewsQueryDto,
  ): Promise<NewsPageView<PaginatedNews>> {
    return newsPageView(await this._newsService.findAllForAdmin(query));
  }

  /**
   * Retrieves any post by ID including drafts (admin only).
   *
   * @param id - The post ID.
   * @returns The post.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin/:id')
  @ApiOperation({ summary: 'Get a news post by ID (admin)' })
  async findOneForAdmin(@Param('id') id: string): Promise<NewsPostView> {
    return newsPostView(await this._newsService.findOneById(id));
  }

  /**
   * Retrieves a published post by slug (public).
   *
   * @param slug - The post slug.
   * @returns The published post.
   */
  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get a published news post by slug' })
  async findOneBySlug(
    @Param('slug') slug: string,
  ): Promise<NewsPostView<PublishedNewsPost>> {
    return newsPostView(await this._newsService.findPublishedBySlug(slug));
  }

  /**
   * Creates a news post (admin only).
   *
   * @param userId - The authenticated administrator's ID.
   * @param dto - The post data.
   * @returns The created post.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a news post (admin)' })
  async create(
    @UserId() userId: string,
    @Body() dto: CreateNewsPostDto,
  ): Promise<NewsPostView> {
    return newsPostView(await this._newsService.create(dto, userId));
  }

  /**
   * Updates a news post (admin only).
   *
   * @param id - The post ID.
   * @param dto - The partial update.
   * @returns The updated post.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a news post (admin)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNewsPostDto,
  ): Promise<NewsPostView> {
    return newsPostView(await this._newsService.update(id, dto));
  }

  /**
   * Publishes a news post immediately (admin only).
   *
   * @param id - The post ID.
   * @returns The published post.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a news post (admin)' })
  async publish(@Param('id') id: string): Promise<NewsPostView> {
    return newsPostView(await this._newsService.publish(id));
  }

  /**
   * Soft-deletes a news post, and takes its cover down (admin only).
   *
   * @param id - The post ID.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a news post (admin)' })
  remove(@Param('id') id: string) {
    return this._newsService.remove(id);
  }

  /**
   * Sends a post's cover to be scanned (admin only). The post shows its old
   * cover, if any, until the new one is cleared (sc-1447).
   *
   * @param id - The post ID.
   * @param userId - The uploading administrator.
   * @param file - The cropped image.
   * @param dto - What it shows.
   * @returns The upload to ask about, and how far along it is.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post(':id/cover-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Set a news post’s cover (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(STORYTIME_IMAGE_UPLOAD_SCHEMA)
  @ApiAcceptedResponse({ type: AssetScanStatusDto })
  @ApiBadRequestResponse({
    description:
      'No image was supplied, the file is not a format a cover takes, the ' +
      'crop is smaller than a cover allows, or the picture is not described.',
  })
  @ApiPayloadTooLargeResponse({ description: 'The image is too large.' })
  @ApiNotFoundResponse({ description: 'No such post.' })
  @UseFilters(FileSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor(STORYTIME_IMAGE_FIELD, STORYTIME_IMAGE_UPLOAD_OPTIONS),
  )
  setCover(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: FleetImageUploadDto,
  ): Promise<AssetScanStatusDto> {
    assertImageSupplied(file);

    return this._newsService.setCover(id, {
      userId,
      altText: dto.altText,
      file,
    });
  }

  /**
   * Takes a post's cover down (admin only).
   *
   * @param id - The post ID.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete(':id/cover-image')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a news post’s cover (admin)' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'No such post, or it has no cover.' })
  clearCover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this._newsService.clearCover(id);
  }
}
