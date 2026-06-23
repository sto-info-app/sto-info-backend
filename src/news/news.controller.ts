import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Public } from 'src/auth/public.decorator';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';
import { CreateNewsPostDto } from './dto/create-news-post.dto';
import { NewsQueryDto } from './dto/news-query.dto';
import { UpdateNewsPostDto } from './dto/update-news-post.dto';
import { NewsService } from './news.service';

@ApiTags('News')
@Controller('news')
export class NewsController {
  /**
   * Creates an instance of NewsController.
   *
   * @param newsService - The news service.
   */
  constructor(private readonly newsService: NewsService) {}

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
  findPublished(@Query() query: NewsQueryDto) {
    return this.newsService.findPublished(query);
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
  findAllForAdmin(@Query() query: NewsQueryDto) {
    return this.newsService.findAllForAdmin(query);
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
  findOneForAdmin(@Param('id') id: string) {
    return this.newsService.findOneById(id);
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
  findOneBySlug(@Param('slug') slug: string) {
    return this.newsService.findPublishedBySlug(slug);
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
  create(@UserId() userId: string, @Body() dto: CreateNewsPostDto) {
    return this.newsService.create(dto, userId);
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
  update(@Param('id') id: string, @Body() dto: UpdateNewsPostDto) {
    return this.newsService.update(id, dto);
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
  publish(@Param('id') id: string) {
    return this.newsService.publish(id);
  }

  /**
   * Soft-deletes a news post (admin only).
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
    return this.newsService.remove(id);
  }
}
