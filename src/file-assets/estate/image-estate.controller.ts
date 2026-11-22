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

import { ImageEstateRunEntity } from './image-estate-run.entity';
import {
  ImageEstateRunDto,
  ImageEstateStatusDto,
  ImageInventoryDto,
  StartImageEstateRunDto,
} from './image-estate.dto';
import { ImageEstateService } from './image-estate.service';
import { ImageInventoryRunEntity } from './image-inventory-run.entity';
import { ImageInventoryService } from './image-inventory.service';

/**
 * Shows a run.
 *
 * @param run - The run.
 * @returns It, as the page shows it.
 */
function runDto(run: ImageEstateRunEntity): ImageEstateRunDto {
  return {
    id: run.id,
    kind: run.kind,
    state: run.state,
    counts: { ...run.counts } as Record<string, number>,
    lastError: run.lastError,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}

/**
 * Shows an inventory.
 *
 * @param inventory - The inventory.
 * @returns It, as the page shows it.
 */
function inventoryDto(inventory: ImageInventoryRunEntity): ImageInventoryDto {
  return {
    id: inventory.id,
    state: inventory.state,
    report: inventory.report,
    error: inventory.error,
    createdAt: inventory.createdAt,
    finishedAt: inventory.finishedAt,
  };
}

/**
 * The site admins' image estate (FC-040), on Scan Diagnostics: its
 * inventory, and the runs that move every picture to private delivery.
 */
@ApiTags('File scanning (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
@Controller('admin/image-estate')
export class ImageEstateController {
  /**
   * Creates an instance of ImageEstateController.
   *
   * @param _estate - The runs.
   * @param _inventory - The inventory.
   */
  constructor(
    private readonly _estate: ImageEstateService,
    private readonly _inventory: ImageInventoryService,
  ) {}

  /**
   * Where the estate stands.
   *
   * @returns The status.
   */
  @Get()
  @ApiOperation({ summary: 'Read the image estate’s status (admin)' })
  @ApiOkResponse({ type: ImageEstateStatusDto })
  async status(): Promise<ImageEstateStatusDto> {
    const [status, inventory] = await Promise.all([
      this._estate.status(),
      this._inventory.latest(),
    ]);

    return {
      signingEnabled: status.signingEnabled,
      remaining: status.remaining,
      steps: status.steps,
      run: status.run === null ? null : runDto(status.run),
      inventory: inventory === null ? null : inventoryDto(inventory),
    };
  }

  /**
   * Takes an inventory. It reports and changes nothing.
   *
   * @param adminUserId - The site admin.
   * @returns The inventory, running.
   */
  @Post('inventory')
  @ApiOperation({ summary: 'Take an inventory of the image estate (admin)' })
  @ApiOkResponse({ type: ImageInventoryDto })
  @ApiConflictResponse({ description: 'One is running already.' })
  async inventory(@UserId() adminUserId: string): Promise<ImageInventoryDto> {
    return inventoryDto(await this._inventory.start(adminUserId));
  }

  /**
   * Starts a copy, an undo or a retirement.
   *
   * @param adminUserId - The site admin.
   * @param dto - Which, and why.
   * @returns The run.
   */
  @Post('runs')
  @ApiOperation({
    summary: 'Copy, undo or retire the image estate, with a reason (admin)',
  })
  @ApiOkResponse({ type: ImageEstateRunDto })
  @ApiConflictResponse({
    description:
      'A run is open, the signing key is not set, or nothing is waiting.',
  })
  async start(
    @UserId() adminUserId: string,
    @Body() dto: StartImageEstateRunDto,
  ): Promise<ImageEstateRunDto> {
    return runDto(await this._estate.start(dto.kind, adminUserId, dto.reason));
  }

  /**
   * Pauses the open run after its batch.
   *
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The run.
   */
  @Post('runs/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause the image estate’s run (admin)' })
  @ApiOkResponse({ type: ImageEstateRunDto })
  @ApiConflictResponse({ description: 'No run is running.' })
  async pause(
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<ImageEstateRunDto> {
    return runDto(await this._estate.pause(adminUserId, dto.reason));
  }

  /**
   * Resumes a paused or failed run.
   *
   * @param adminUserId - The site admin.
   * @param dto - Why.
   * @returns The run.
   */
  @Post('runs/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume the image estate’s run (admin)' })
  @ApiOkResponse({ type: ImageEstateRunDto })
  @ApiConflictResponse({ description: 'No run is paused or failed.' })
  async resume(
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<ImageEstateRunDto> {
    return runDto(await this._estate.resume(adminUserId, dto.reason));
  }
}
