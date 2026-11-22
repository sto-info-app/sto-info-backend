import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserRole } from 'src/user/enums/user-role.enum';

import { SecurityLogPageDto, SecurityLogQueryDto } from './security-log.dto';
import { SecurityLogService } from './security-log.service';

/** The site admins' Security Log (FC-039). */
@ApiTags('Security (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/security-log')
export class SecurityLogController {
  constructor(private readonly _log: SecurityLogService) {}

  @Get()
  @ApiOperation({
    summary: 'Read what site admins and retention jobs did (admin)',
  })
  @ApiOkResponse({ type: SecurityLogPageDto })
  @ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
  list(@Query() query: SecurityLogQueryDto): Promise<SecurityLogPageDto> {
    return this._log.list(query.source, query.page ?? 1);
  }
}
