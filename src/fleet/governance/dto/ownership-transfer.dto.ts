import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { OwnershipTransferState } from '../enums/ownership-transfer-status.enum';
import {
  GovernancePersonDto,
  GovernanceReasonDto,
} from './scope-governance.dto';

/** An offer of a Community's ownership. */
export class OwnershipTransferDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({
    type: GovernancePersonDto,
    description: 'The Owner offering.',
  })
  from: GovernancePersonDto;

  @ApiProperty({ type: GovernancePersonDto, description: 'The Admin offered.' })
  to: GovernancePersonDto;

  @ApiProperty({ enum: OwnershipTransferState })
  state: OwnershipTransferState;

  @ApiProperty({ description: 'When it was offered.' })
  offeredAt: Date;

  @ApiProperty({ description: 'When it stops being answerable.' })
  expiresAt: Date;

  @ApiPropertyOptional({
    description: 'When it was answered or taken back.',
    nullable: true,
  })
  answeredAt: Date | null;
}

/** Where a Community's ownership stands, for its Owner and the Admin offered. */
export class OwnershipStandingDto {
  @ApiProperty({
    type: OwnershipTransferDto,
    nullable: true,
    description:
      'The open offer, when the reader is its Owner or the Admin offered ' +
      'it. Null otherwise, and once it has expired.',
  })
  offer: OwnershipTransferDto | null;

  @ApiProperty({
    type: [GovernancePersonDto],
    description:
      'The Admins the Owner may offer it to. Empty for anybody but the Owner.',
  })
  eligible: GovernancePersonDto[];
}

/** Offers the Community to one of its Admins. */
export class OfferOwnershipDto {
  @ApiProperty({ description: 'The Admin to offer it to.' })
  @IsUUID()
  readonly toUserId: string;
}

/** A site administrator's dispute action: who becomes the Owner, and why. */
export class ReassignOwnershipDto extends GovernanceReasonDto {
  @ApiProperty({ description: 'The Admin who becomes the Owner.' })
  @IsUUID()
  readonly toUserId: string;
}

/** A Community, as a site administrator sees it for a dispute. */
export class CommunityDisputeViewDto {
  @ApiProperty({ description: 'The Community.' })
  communityId: string;

  @ApiProperty({ description: 'Its name.' })
  name: string;

  @ApiProperty({ enum: FleetScopeStatus })
  status: FleetScopeStatus;

  @ApiProperty({
    type: GovernancePersonDto,
    nullable: true,
    description:
      'Its Owner, or null for a closed Community whose Owner’s account was ' +
      'erased (FC-038).',
  })
  owner: GovernancePersonDto | null;

  @ApiProperty({
    type: [GovernancePersonDto],
    description: 'Its Admins, any of whom may be made the Owner.',
  })
  admins: GovernancePersonDto[];

  @ApiProperty({
    type: OwnershipTransferDto,
    nullable: true,
    description: 'An open offer, which a dispute action cancels.',
  })
  offer: OwnershipTransferDto | null;
}
