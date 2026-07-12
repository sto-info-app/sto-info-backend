import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { OptionalUserId } from 'src/auth/user-id.decorator';
import { NotificationService } from './notification.service';

@ApiTags('App State')
@Controller('app-state')
export class AppStateController {
  /**
   * Creates an instance of AppStateController.
   *
   * @param _notificationService - The notification service.
   */
  constructor(private readonly _notificationService: NotificationService) {}

  /**
   * Returns the polled application state in a single call: the active site
   * banners for everyone, plus the unread notification count when the caller
   * is authenticated.
   *
   * Uses {@link OptionalJwtAuthGuard} so anonymous callers receive banners with
   * an unread count of zero, while logged-in callers also get their live count.
   *
   * @param userId - The authenticated user's ID, or `null` when anonymous.
   * @returns The active banners and the caller's unread count.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Get polled app state (banners + unread count)' })
  @ApiOkResponse({ description: 'Active banners and the caller unread count.' })
  getAppState(@OptionalUserId() userId: string | null) {
    return this._notificationService.getAppState(userId);
  }
}
