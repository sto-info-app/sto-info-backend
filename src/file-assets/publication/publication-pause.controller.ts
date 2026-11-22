import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';
import { UserRole } from 'src/user/enums/user-role.enum';

import { PublicationPauseDto } from './publication-pause.dto';
import { PublicationPauseService } from './publication-pause.service';

/**
 * The site admins' publication pause (FC-042), on the Admin page: uploads
 * are still accepted and scanned while it is on, and nothing is published
 * until it is off. Each change takes a reason for the site admin log.
 */
@ApiTags('File scanning (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
@Controller('admin/file-publication')
export class PublicationPauseController {
  /**
   * Creates an instance of PublicationPauseController.
   *
   * @param _pause - The publication pause.
   */
  constructor(private readonly _pause: PublicationPauseService) {}

  /**
   * Whether publication is paused.
   *
   * @returns The switch, and the queue as it stands.
   */
  @Get()
  @ApiOperation({ summary: 'Read the publication pause (admin)' })
  @ApiOkResponse({ type: PublicationPauseDto })
  read(): Promise<PublicationPauseDto> {
    return this._pause.read();
  }

  /**
   * Pauses publication.
   *
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The switch, and the queue.
   */
  @Post('pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause publication, with a reason (admin)' })
  @ApiOkResponse({ type: PublicationPauseDto })
  @ApiConflictResponse({ description: 'It is already paused.' })
  pause(
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<PublicationPauseDto> {
    return this._pause.pause(adminUserId, dto.reason);
  }

  /**
   * Resumes publication: everything held publishes.
   *
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The switch, and the queue.
   */
  @Post('resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume publication, with a reason (admin)' })
  @ApiOkResponse({ type: PublicationPauseDto })
  @ApiConflictResponse({ description: 'It is not paused.' })
  resume(
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<PublicationPauseDto> {
    return this._pause.resume(adminUserId, dto.reason);
  }
}
