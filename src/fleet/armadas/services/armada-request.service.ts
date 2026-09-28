import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  QueryFailedError,
} from 'typeorm';

import { CRON_TIMEZONE } from '../../../cron/constants/cron.constants';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import {
  optionalReason,
  requireReason,
} from '../../governance/utilities/governance-scope.utility';
import {
  ARMADA_REQUEST_DAYS,
  ArmadaSlotDto,
  CreateArmadaRequestDto,
} from '../dto/armada-topology.dto';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';
import {
  applyArmadaChange,
  ArmadaSlot,
  lockArmada,
  openPlacementOf,
  openPlacements,
} from '../utilities/armada-arrangement.utility';
import { ArmadaNotifierService } from './armada-notifier.service';

/** What to say of a request that is no longer open. */
export const REQUEST_NOT_OPEN =
  'This request has been answered already, or has lapsed.';

/**
 * Reads where a request asks a Fleet to go.
 *
 * @param dto - What the approver chose.
 * @returns The slot.
 * @throws BadRequestException for a Gamma with no Beta, or a parent given to
 *   anything else.
 */
export function slotOf(dto: ArmadaSlotDto): ArmadaSlot {
  if (dto.position === ArmadaPosition.GAMMA) {
    if (dto.parentFleetId === undefined) {
      throw new BadRequestException('Say which Beta the Gamma sits under.');
    }

    return { position: dto.position, parentFleetId: dto.parentFleetId };
  }

  if (dto.parentFleetId !== undefined) {
    throw new BadRequestException('Only a Gamma sits under a Beta.');
  }

  return { position: dto.position, parentFleetId: null };
}

/**
 * A Fleet's requests to join an Armada, and their answers (FC-025).
 *
 * Steve's decisions of 28 September 2026:
 *
 * - A Fleet joins an Armada in its own Community only by asking, and only an
 *   `armada.manage` holder answers. The request carries an optional message;
 *   the approver chooses where the Fleet goes.
 * - The Fleet must be on the Armada's platform and share its allegiance,
 *   Federation or Klingon.
 * - A request lapses after fourteen days, and a Fleet has one open at a
 *   time. It can be withdrawn. A rejection needs a reason, which the
 *   requester is shown.
 */
@Injectable()
export class ArmadaRequestService {
  private readonly _logger = new Logger(ArmadaRequestService.name);

  /**
   * Creates an instance of ArmadaRequestService.
   *
   * @param _dataSource - The database.
   * @param _notifier - Tells the requester the outcome.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _notifier: ArmadaNotifierService,
  ) {}

  /**
   * Asks for a Fleet to join an Armada.
   *
   * @param communityId - The Community named in the route.
   * @param fleetId - The Fleet.
   * @param dto - The Armada, and anything to say.
   * @param userId - Who asks, holding `armada.request` at the Fleet.
   * @throws NotFoundException for an unknown Fleet or Armada.
   * @throws BadRequestException for another platform or allegiance.
   * @throws ConflictException when either is closed, the Armada has no
   *   allegiance, the Fleet is placed already or has a request open.
   */
  async request(
    communityId: string,
    fleetId: string,
    dto: CreateArmadaRequestDto,
    userId: string,
  ): Promise<void> {
    try {
      await this._dataSource.transaction(async manager => {
        const fleet = await this.lockFleet(manager, communityId, fleetId);
        const armada = await manager.findOne(StoArmadaEntity, {
          where: { id: dto.armadaId, communityId, deletedAt: IsNull() },
        });

        if (!armada) {
          throw new NotFoundException('No such Armada in this Community.');
        }

        this.assertMayJoin(fleet, armada);

        if ((await openPlacementOf(manager, fleet.id)) !== null) {
          throw new ConflictException(
            'This Fleet is in an Armada already. It has to leave that one first.',
          );
        }

        const now = new Date();

        await this.lapseExpiredOf(manager, fleet.id, now);

        if (
          await manager.exists(ArmadaJoinRequestEntity, {
            where: { fleetId, status: ArmadaJoinRequestStatus.PENDING },
          })
        ) {
          throw new ConflictException(
            'This Fleet already has an open request.',
          );
        }

        await manager.insert(ArmadaJoinRequestEntity, {
          communityId,
          armadaId: armada.id,
          fleetId,
          requestedByUserId: userId,
          message: optionalReason(dto.message),
          createdAt: now,
          expiresAt: new Date(
            now.getTime() + ARMADA_REQUEST_DAYS * 24 * 60 * 60 * 1000,
          ),
        });
      });
    } catch (error) {
      // The partial unique index settles two requests racing each other.
      if (
        error instanceof QueryFailedError &&
        error.message.includes('UX_armada_join_request_open')
      ) {
        throw new ConflictException('This Fleet already has an open request.');
      }

      throw error;
    }
  }

  /**
   * Withdraws a Fleet's open request.
   *
   * @param communityId - The Community named in the route.
   * @param fleetId - The Fleet.
   * @param requestId - The request.
   * @param userId - Who withdraws it.
   * @throws ConflictException when it is not open.
   */
  async withdraw(
    communityId: string,
    fleetId: string,
    requestId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    const result = await this._dataSource.manager.update(
      ArmadaJoinRequestEntity,
      {
        id: requestId,
        communityId,
        fleetId,
        status: ArmadaJoinRequestStatus.PENDING,
        expiresAt: MoreThan(now),
      },
      {
        status: ArmadaJoinRequestStatus.WITHDRAWN,
        answeredAt: now,
        answeredByUserId: userId,
      },
    );

    if (!result.affected) {
      throw new ConflictException(REQUEST_NOT_OPEN);
    }
  }

  /**
   * Approves a request, placing the Fleet where the approver chooses.
   *
   * @param communityId - The Community named in the route.
   * @param armadaId - The Armada.
   * @param requestId - The request.
   * @param dto - Where the Fleet goes.
   * @param userId - The approver, holding `armada.manage` there.
   * @throws ConflictException when the request is not open, or the Fleet can
   *   no longer join.
   * @throws BadRequestException when the place does not fit.
   */
  async approve(
    communityId: string,
    armadaId: string,
    requestId: string,
    dto: ArmadaSlotDto,
    userId: string,
  ): Promise<void> {
    const slot = slotOf(dto);
    const request = await this._dataSource.transaction(async manager => {
      const armada = await lockArmada(manager, communityId, armadaId);
      const open = await this.openRequest(manager, armadaId, requestId);
      const fleet = await manager.findOne(StoFleetEntity, {
        where: { id: open.fleetId, deletedAt: IsNull() },
      });

      if (!fleet) {
        throw new ConflictException('That Fleet is no longer registered.');
      }

      this.assertMayJoin(fleet, armada);

      if ((await openPlacementOf(manager, fleet.id)) !== null) {
        throw new ConflictException('That Fleet is in an Armada already.');
      }

      const now = new Date();
      const started = await applyArmadaChange(
        manager,
        armada,
        await openPlacements(manager, armada.id),
        new Map([[fleet.id, { slot, action: ArmadaActionKind.PLACED }]]),
        { actorUserId: userId, reason: null, requestId: open.id, now },
      );

      open.status = ArmadaJoinRequestStatus.APPROVED;
      open.answeredAt = now;
      open.answeredByUserId = userId;
      // The change placed it, or it threw.
      open.membershipId = (
        started.get(fleet.id) as ArmadaFleetMembershipEntity
      ).id;

      return manager.save(ArmadaJoinRequestEntity, open);
    });

    await this._notifier.approved(request, slot.position);
  }

  /**
   * Rejects a request, with the reason the requester is shown.
   *
   * @param communityId - The Community named in the route.
   * @param armadaId - The Armada.
   * @param requestId - The request.
   * @param reason - Why.
   * @param userId - Who rejects it, holding `armada.manage` there.
   * @throws BadRequestException when no reason is given.
   * @throws ConflictException when the request is not open.
   */
  async reject(
    communityId: string,
    armadaId: string,
    requestId: string,
    reason: string,
    userId: string,
  ): Promise<void> {
    const why = requireReason(reason, 'Say why, for the requesting Fleet.');
    const request = await this._dataSource.transaction(async manager => {
      await lockArmada(manager, communityId, armadaId);

      const open = await this.openRequest(manager, armadaId, requestId);

      open.status = ArmadaJoinRequestStatus.REJECTED;
      open.answeredAt = new Date();
      open.answeredByUserId = userId;
      open.reason = why;

      return manager.save(ArmadaJoinRequestEntity, open);
    });

    await this._notifier.rejected(request);
  }

  /**
   * Lapses every request left unanswered past its fourteen days, and tells
   * each requester. Hourly, so a lapse is noticed within the hour.
   *
   * @returns How many lapsed.
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: CRON_TIMEZONE })
  async lapseExpired(): Promise<number> {
    const now = new Date();
    const expired = await this._dataSource.manager.find(
      ArmadaJoinRequestEntity,
      {
        where: {
          status: ArmadaJoinRequestStatus.PENDING,
          expiresAt: LessThanOrEqual(now),
        },
      },
    );
    let lapsed = 0;

    for (const request of expired) {
      // Only if still open, so a request answered meanwhile is left alone.
      const result = await this._dataSource.manager.update(
        ArmadaJoinRequestEntity,
        { id: request.id, status: ArmadaJoinRequestStatus.PENDING },
        { status: ArmadaJoinRequestStatus.LAPSED, answeredAt: now },
      );

      if (result.affected) {
        lapsed += 1;
        await this._notifier.lapsed(request);
      }
    }

    if (lapsed > 0) {
      this._logger.log(
        `[lapseExpired] Armada requests lapsed - Count: ${lapsed}`,
      );
    }

    return lapsed;
  }

  /**
   * Refuses a Fleet an Armada would not take.
   *
   * @param fleet - The Fleet.
   * @param armada - The Armada.
   * @throws ConflictException when either is closed, or the Armada has no
   *   allegiance yet.
   * @throws BadRequestException for another platform or allegiance.
   */
  private assertMayJoin(fleet: StoFleetEntity, armada: StoArmadaEntity): void {
    if (fleet.status !== FleetScopeStatus.ACTIVE) {
      throw new ConflictException('That Fleet is closed.');
    }

    if (armada.status !== FleetScopeStatus.ACTIVE) {
      throw new ConflictException('That Armada is closed.');
    }

    if (fleet.platformId !== armada.platformId) {
      throw new BadRequestException(
        'An Armada takes Fleets on its own platform only.',
      );
    }

    if (armada.allegianceFactionId === null) {
      throw new ConflictException(
        'That Armada has no allegiance set yet, so it takes no Fleets.',
      );
    }

    if (fleet.allegianceFactionId !== armada.allegianceFactionId) {
      throw new BadRequestException(
        'An Armada takes Fleets of its own allegiance only.',
      );
    }
  }

  /**
   * Locks a Fleet's row, so its requests are made one at a time.
   *
   * @param manager - The transaction.
   * @param communityId - The Community named in the route.
   * @param fleetId - The Fleet.
   * @returns The Fleet.
   * @throws NotFoundException when that Community holds no such Fleet.
   */
  private async lockFleet(
    manager: EntityManager,
    communityId: string,
    fleetId: string,
  ): Promise<StoFleetEntity> {
    const fleet = await manager.findOne(StoFleetEntity, {
      where: { id: fleetId, communityId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });

    if (!fleet) {
      throw new NotFoundException('Not found');
    }

    return fleet;
  }

  /**
   * Reads a request to an Armada that is still open.
   *
   * @param manager - The transaction, holding the Armada's lock.
   * @param armadaId - The Armada.
   * @param requestId - The request.
   * @returns The request.
   * @throws ConflictException when it is not open, or has lapsed.
   */
  private async openRequest(
    manager: EntityManager,
    armadaId: string,
    requestId: string,
  ): Promise<ArmadaJoinRequestEntity> {
    const request = await manager.findOne(ArmadaJoinRequestEntity, {
      where: {
        id: requestId,
        armadaId,
        status: ArmadaJoinRequestStatus.PENDING,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!request) {
      throw new ConflictException(REQUEST_NOT_OPEN);
    }

    return request;
  }

  /**
   * Marks a Fleet's open request lapsed if its time has run out, so a new
   * one can be made. The sweep tells the requester of lapses it finds; one
   * found here is being replaced, so nobody is told.
   *
   * @param manager - The transaction.
   * @param fleetId - The Fleet.
   * @param now - When.
   */
  private async lapseExpiredOf(
    manager: EntityManager,
    fleetId: string,
    now: Date,
  ): Promise<void> {
    await manager.update(
      ArmadaJoinRequestEntity,
      {
        fleetId,
        status: ArmadaJoinRequestStatus.PENDING,
        expiresAt: LessThanOrEqual(now),
      },
      { status: ArmadaJoinRequestStatus.LAPSED, answeredAt: now },
    );
  }
}
