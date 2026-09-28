import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull } from 'typeorm';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { requireReason } from '../../governance/utilities/governance-scope.utility';
import {
  ArmadaReasonDto,
  GammaResolutionDto,
  MoveArmadaFleetDto,
  RemoveArmadaFleetDto,
} from '../dto/armada-topology.dto';
import { ArmadaActionKind } from '../enums/armada-action-kind.enum';
import {
  applyArmadaChange,
  ArmadaChange,
  ArmadaSlot,
  arrangementOf,
  lockArmada,
  openPlacementOf,
  openPlacements,
} from '../utilities/armada-arrangement.utility';
import { ArmadaNotifierService } from './armada-notifier.service';
import { slotOf } from './armada-request.service';

/**
 * Moves Fleets within an Armada, and takes them out of it (FC-024).
 *
 * Steve's decisions of 28 September 2026:
 *
 * - An `armada.manage` holder moves a placed Fleet, or removes it. Either
 *   needs a reason. The Alpha slot may be left empty.
 * - When a Beta stops being one, its manager says what becomes of each of
 *   its Gammas: moved under another Beta with room, made a Beta if there is
 *   room, or taken out too — all in the same change.
 * - A Fleet's own `armada.request` holders may take it out, with a reason,
 *   but not a Beta with Gammas under it: those belong to other Fleets, so an
 *   Armada manager has to move or remove them first.
 * - A removed Fleet's Owner and Admins are told, with the reason.
 */
@Injectable()
export class ArmadaArrangeService {
  /**
   * Creates an instance of ArmadaArrangeService.
   *
   * @param _dataSource - The database.
   * @param _notifier - Tells a removed Fleet's managers.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _notifier: ArmadaNotifierService,
  ) {}

  /**
   * Moves a placed Fleet to another position or Beta.
   *
   * @param communityId - The Community named in the route.
   * @param armadaId - The Armada.
   * @param fleetId - The Fleet.
   * @param dto - Where it goes, why, and what becomes of its Gammas.
   * @param userId - Who moves it, holding `armada.manage` there.
   * @throws NotFoundException when the Fleet is not in the Armada.
   * @throws BadRequestException when no reason is given, it is there
   *   already, or the result does not fit.
   */
  async move(
    communityId: string,
    armadaId: string,
    fleetId: string,
    dto: MoveArmadaFleetDto,
    userId: string,
  ): Promise<void> {
    const reason = requireReason(dto.reason, 'Say why it is being moved.');
    const target = slotOf(dto);

    await this._dataSource.transaction(async manager => {
      const armada = await lockArmada(manager, communityId, armadaId);
      const placements = await openPlacements(manager, armada.id);
      const current = this.slotIn(placements, fleetId);

      if (
        current.position === target.position &&
        current.parentFleetId === target.parentFleetId
      ) {
        throw new BadRequestException('It is there already.');
      }

      const changes = this.withGammas(
        placements,
        fleetId,
        { slot: target, action: ArmadaActionKind.MOVED },
        target.position === ArmadaPosition.BETA ? [] : (dto.gammas ?? []),
      );

      await applyArmadaChange(manager, armada, placements, changes, {
        actorUserId: userId,
        reason,
        now: new Date(),
      });
    });
  }

  /**
   * Takes a Fleet out of an Armada, as its manager.
   *
   * @param communityId - The Community named in the route.
   * @param armadaId - The Armada.
   * @param fleetId - The Fleet.
   * @param dto - Why, and what becomes of its Gammas.
   * @param userId - Who removes it, holding `armada.manage` there.
   * @throws NotFoundException when the Fleet is not in the Armada.
   * @throws BadRequestException when no reason is given, or the result does
   *   not fit.
   */
  async remove(
    communityId: string,
    armadaId: string,
    fleetId: string,
    dto: RemoveArmadaFleetDto,
    userId: string,
  ): Promise<void> {
    const reason = requireReason(dto.reason, 'Say why it is being removed.');
    const removed = await this._dataSource.transaction(async manager => {
      const armada = await lockArmada(manager, communityId, armadaId);
      const placements = await openPlacements(manager, armada.id);

      this.slotIn(placements, fleetId);

      const changes = this.withGammas(
        placements,
        fleetId,
        { slot: null, action: ArmadaActionKind.REMOVED },
        dto.gammas ?? [],
      );

      await applyArmadaChange(manager, armada, placements, changes, {
        actorUserId: userId,
        reason,
        now: new Date(),
      });

      return [...changes.entries()]
        .filter(([, change]) => change.slot === null)
        .map(([id]) => id);
    });

    await this._notifier.removed(armadaId, removed, reason, userId);
  }

  /**
   * Takes a Fleet out of its Armada, as the Fleet's own manager.
   *
   * @param communityId - The Community named in the route.
   * @param fleetId - The Fleet.
   * @param dto - Why.
   * @param userId - Who takes it out, holding `armada.request` there.
   * @throws NotFoundException when the Fleet is in no Armada.
   * @throws BadRequestException when no reason is given.
   * @throws ConflictException for a Beta with Gammas under it.
   */
  async leave(
    communityId: string,
    fleetId: string,
    dto: ArmadaReasonDto,
    userId: string,
  ): Promise<void> {
    const reason = requireReason(dto.reason, 'Say why it is leaving.');

    await this._dataSource.transaction(async manager => {
      const fleet = await manager.findOne(StoFleetEntity, {
        where: { id: fleetId, communityId, deletedAt: IsNull() },
      });
      const placement =
        fleet === null ? null : await openPlacementOf(manager, fleetId);

      if (fleet === null || placement === null) {
        throw new NotFoundException('This Fleet is in no Armada.');
      }

      const armada = await lockArmada(manager, communityId, placement.armadaId);
      const placements = await openPlacements(manager, armada.id);

      this.slotIn(placements, fleetId);

      if (
        [...arrangementOf(placements).values()].some(
          slot => slot.parentFleetId === fleetId,
        )
      ) {
        throw new ConflictException(
          `${fleet.exactGameName} has Gammas under it. An Armada manager has ` +
            'to move or remove them before it can leave.',
        );
      }

      await applyArmadaChange(
        manager,
        armada,
        placements,
        new Map([[fleetId, { slot: null, action: ArmadaActionKind.LEFT }]]),
        { actorUserId: userId, reason, now: new Date() },
      );
    });
  }

  /**
   * Reads where a Fleet sits in an Armada.
   *
   * @param placements - The Armada's open placements.
   * @param fleetId - The Fleet.
   * @returns Its slot.
   * @throws NotFoundException when it is not placed there.
   */
  private slotIn(
    placements: Parameters<typeof arrangementOf>[0],
    fleetId: string,
  ): ArmadaSlot {
    const slot = arrangementOf(placements).get(fleetId);

    if (slot === undefined) {
      throw new NotFoundException('That Fleet is not in this Armada.');
    }

    return slot;
  }

  /**
   * Adds to a change what becomes of a Beta's Gammas.
   *
   * Nothing is decided for a Gamma that is not given: the arrangement check
   * then refuses a Gamma left under a Beta that has gone, and names the Beta.
   *
   * @param placements - The Armada's open placements.
   * @param fleetId - The Fleet the change is about.
   * @param change - What happens to it.
   * @param gammas - What becomes of each of its Gammas.
   * @returns Every Fleet the change touches.
   * @throws BadRequestException for a Fleet that is not one of its Gammas,
   *   or one named twice.
   */
  private withGammas(
    placements: Parameters<typeof arrangementOf>[0],
    fleetId: string,
    change: ArmadaChange,
    gammas: readonly GammaResolutionDto[],
  ): Map<string, ArmadaChange> {
    const arrangement = arrangementOf(placements);
    const changes = new Map<string, ArmadaChange>([[fleetId, change]]);

    for (const gamma of gammas) {
      if (arrangement.get(gamma.fleetId)?.parentFleetId !== fleetId) {
        throw new BadRequestException(
          'Only the Gammas under the Fleet being moved can go with it.',
        );
      }

      if (changes.has(gamma.fleetId)) {
        throw new BadRequestException('Each Gamma is decided once.');
      }

      changes.set(
        gamma.fleetId,
        gamma.outcome === 'LEAVE'
          ? { slot: null, action: ArmadaActionKind.REMOVED }
          : {
              slot:
                gamma.outcome === 'BETA'
                  ? { position: ArmadaPosition.BETA, parentFleetId: null }
                  : slotOf({
                      position: ArmadaPosition.GAMMA,
                      parentFleetId: gamma.parentFleetId,
                    }),
              action: ArmadaActionKind.MOVED,
            },
      );
    }

    return changes;
  }
}
