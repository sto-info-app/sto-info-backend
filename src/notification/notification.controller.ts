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
import { CreateBannerDto } from './dto/create-banner.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  /**
   * Creates an instance of NotificationController.
   *
   * @param notificationService - The notification service.
   */
  constructor(private readonly notificationService: NotificationService) {}

  // ----- Public -----

  /**
   * Lists the currently active site banners (public).
   *
   * @returns The active banners.
   */
  @Public()
  @Get('banners')
  @ApiOperation({ summary: 'List active site banners' })
  @ApiOkResponse({ description: 'The active banners.' })
  findActiveBanners() {
    return this.notificationService.findActiveBanners();
  }

  // ----- Authenticated user inbox -----

  /**
   * Returns the authenticated user's inbox.
   *
   * @param userId - The authenticated user's ID.
   * @param query - Pagination and unread filter.
   * @returns A page of inbox items.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Get the current user inbox' })
  getInbox(@UserId() userId: string, @Query() query: InboxQueryDto) {
    return this.notificationService.getInbox(userId, query);
  }

  /**
   * Returns the authenticated user's unread notification count.
   *
   * @param userId - The authenticated user's ID.
   * @returns The unread count.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('unread-count')
  @ApiOperation({ summary: 'Get the current user unread count' })
  async getUnreadCount(@UserId() userId: string) {
    return {
      unreadCount: await this.notificationService.getUnreadCount(userId),
    };
  }

  /**
   * Marks all of the user's notifications as read.
   *
   * @param userId - The authenticated user's ID.
   * @returns The number marked.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@UserId() userId: string) {
    return { marked: await this.notificationService.markAllRead(userId) };
  }

  /**
   * Marks a single notification as read.
   *
   * @param userId - The authenticated user's ID.
   * @param id - The notification ID.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@UserId() userId: string, @Param('id') id: string) {
    return this.notificationService.markRead(userId, id);
  }

  // ----- Admin: banners -----

  /**
   * Lists all banners (admin).
   *
   * @returns All banners.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin/banners')
  @ApiOperation({ summary: 'List all banners (admin)' })
  findAllBanners() {
    return this.notificationService.findAllBanners();
  }

  /**
   * Gets a banner by ID (admin).
   *
   * @param id - The banner ID.
   * @returns The banner.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin/banners/:id')
  @ApiOperation({ summary: 'Get a banner (admin)' })
  findBanner(@Param('id') id: string) {
    return this.notificationService.findBannerById(id);
  }

  /**
   * Creates a banner (admin).
   *
   * @param dto - The banner data.
   * @returns The created banner.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post('admin/banners')
  @ApiOperation({ summary: 'Create a banner (admin)' })
  createBanner(@Body() dto: CreateBannerDto) {
    return this.notificationService.createBanner(dto);
  }

  /**
   * Updates a banner (admin).
   *
   * @param id - The banner ID.
   * @param dto - The partial update.
   * @returns The updated banner.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Patch('admin/banners/:id')
  @ApiOperation({ summary: 'Update a banner (admin)' })
  updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.notificationService.updateBanner(id, dto);
  }

  /**
   * Deletes a banner (admin).
   *
   * @param id - The banner ID.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete('admin/banners/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a banner (admin)' })
  removeBanner(@Param('id') id: string) {
    return this.notificationService.removeBanner(id);
  }

  // ----- Admin: notifications -----

  /**
   * Lists all notifications (admin).
   *
   * @returns All notifications.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin')
  @ApiOperation({ summary: 'List all notifications (admin)' })
  findAllNotifications() {
    return this.notificationService.findAllNotifications();
  }

  /**
   * Creates a notification, broadcast or user-targeted (admin).
   *
   * @param dto - The notification data.
   * @returns The created notification.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post('admin')
  @ApiOperation({ summary: 'Create a notification (admin)' })
  createNotification(@Body() dto: CreateNotificationDto) {
    return this.notificationService.createNotification(dto);
  }

  /**
   * Deletes a notification (admin).
   *
   * @param id - The notification ID.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification (admin)' })
  removeNotification(@Param('id') id: string) {
    return this.notificationService.removeNotification(id);
  }
}
