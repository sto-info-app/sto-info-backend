import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  RosterErasureDto,
  RosterErasurePreviewDto,
  RosterErasureRequestDto,
  RosterErasureResultDto,
  RosterErasureTargetDto,
} from './roster-erasure.dto';
import { RosterErasureService } from './roster-erasure.service';

/** The site admins' verified erasure of roster data (FC-038). */
@ApiTags('Moderation (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiServiceUnavailableResponse({
  description: 'Roster erasure is not configured on this server.',
})
@Controller('admin/roster-erasures')
export class RosterErasuresController {
  constructor(private readonly _erasures: RosterErasureService) {}

  @Get()
  @ApiOperation({ summary: 'List roster erasures (admin)' })
  @ApiOkResponse({ type: [RosterErasureDto] })
  list(): Promise<RosterErasureDto[]> {
    return this._erasures.list();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What erasing a Character name and handle would touch (admin)',
  })
  @ApiOkResponse({ type: RosterErasurePreviewDto })
  preview(
    @Body() target: RosterErasureTargetDto,
  ): Promise<RosterErasurePreviewDto> {
    return this._erasures.preview(target);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Erase a Character name and handle from every roster (admin)',
  })
  @ApiOkResponse({ type: RosterErasureResultDto })
  @ApiConflictResponse({ description: 'They are already erased.' })
  erase(
    @UserId() adminId: string,
    @Body() request: RosterErasureRequestDto,
  ): Promise<RosterErasureResultDto> {
    return this._erasures.erase(adminId, request);
  }
}
