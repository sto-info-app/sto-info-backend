import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, In, IsNull } from 'typeorm';

import { GeneralFactionEntity } from 'src/sto/character/entities/general-faction.entity';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { toPlatformSegment } from '../../utilities/platform-segment.utility';
import {
  ArmadaChangeDto,
  ArmadaFleetRefDto,
  ArmadaHistoryPageDto,
  ArmadaNodeDto,
  ArmadaPageQueryDto,
  ArmadaRefDto,
  ArmadaRequestDto,
  ArmadaRequestPageDto,
  ArmadaRequestQueryDto,
  ArmadaStructureDto,
  ArmadaViewDto,
  CommunityStructureDto,
  FleetArmadaViewDto,
} from '../dto/armada-topology.dto';
import { ArmadaActionEntity } from '../entities/armada-action.entity';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';
import {
  ARMADA_ALLEGIANCES,
  arrangementOf,
  MAX_ARMADA_BETAS,
  MAX_ARMADA_GAMMAS_PER_BETA,
  openPlacementOf,
  openPlacements,
} from '../utilities/armada-arrangement.utility';

/** Rows per page when the caller does not say. */
const DEFAULT_PAGE_SIZE = 25;

/** Names Fleets as one reader may see them. */
type FleetNamer = (fleetId: string) => ArmadaFleetRefDto;

/**
 * Reads Armadas' shapes, their history and their requests (FC-024 to
 * FC-026).
 *
 * Steve's decisions of 28 September 2026: an Armada's shape and history are
 * shown to whoever may see the Armada; who made each change, and why, only
 * to its members. A Fleet the reader may not see is shown in its place
 * without its name, so the Armada's shape stays true without telling anybody
 * that a hidden Fleet exists by name.
 */
@Injectable()
export class ArmadaViewService {
  /**
   * Creates an instance of ArmadaViewService.
   *
   * @param _dataSource - The database.
   * @param _authorisation - Which capabilities a reader holds.
   * @param _audience - Which Fleets a reader may see.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _authorisation: FleetAuthorisationService,
    private readonly _audience: FleetAudienceService,
  ) {}

  /**
   * Describes an Armada's shape for one reader, who may see it.
   *
   * @param armada - The Armada.
   * @param userId - The reader, or null when signed out.
   * @returns Its shape, and what the reader may do.
   */
  async view(
    armada: StoArmadaEntity,
    userId: string | null,
  ): Promise<ArmadaViewDto> {
    const authorisation = await this._authorisation.authorise(userId, {
      kind: FleetScopeKind.ARMADA,
      id: armada.id,
    });
    const mayManage =
      authorisation?.capabilities.has(FLEET_CAPABILITIES.ARMADA_MANAGE) ??
      false;
    const placements = await openPlacements(
      this._dataSource.manager,
      armada.id,
    );

    return {
      structure: this.structureOf(
        placements,
        await this.namer(
          placements.map(placement => placement.fleetId),
          userId,
        ),
      ),
      mayManage,
      isMember: this.isMember(authorisation),
      openRequests: mayManage
        ? await this._dataSource.manager.count(ArmadaJoinRequestEntity, {
            where: {
              armadaId: armada.id,
              status: ArmadaJoinRequestStatus.PENDING,
            },
          })
        : 0,
    };
  }

  /**
   * Reads a page of an Armada's history, newest change first.
   *
   * @param armada - The Armada, which the reader may see.
   * @param userId - The reader, or null when signed out.
   * @param query - Which page.
   * @returns The changes.
   */
  async history(
    armada: StoArmadaEntity,
    userId: string | null,
    query: ArmadaPageQueryDto,
  ): Promise<ArmadaHistoryPageDto> {
    const manager = this._dataSource.manager;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    // An Armada's shape changes a few dozen times in its life, so the whole
    // history is read and paged by change here, rather than asking the
    // database to group and count it.
    const all = await manager.find(ArmadaActionEntity, {
      where: { armadaId: armada.id },
      order: { createdAt: 'DESC', changeId: 'DESC' },
    });
    const changeIds = [...new Set(all.map(action => action.changeId))];
    const ids = changeIds.slice((page - 1) * pageSize, page * pageSize);
    const actions = all
      .filter(action => ids.includes(action.changeId))
      .reverse();
    const authorisation = await this._authorisation.authorise(userId, {
      kind: FleetScopeKind.ARMADA,
      id: armada.id,
    });
    const recordersShown = this.isMember(authorisation);
    const names = recordersShown
      ? await usernamesFor(
          manager,
          actions.map(action => action.actorUserId),
        )
      : new Map<string, string>();
    const nameFleet = await this.namer(
      actions.flatMap(action =>
        [
          action.fleetId,
          action.fromParentFleetId,
          action.toParentFleetId,
        ].filter((id): id is string => id !== null),
      ),
      userId,
    );

    return {
      items: ids.map(changeId =>
        this.describeChange(
          actions.filter(action => action.changeId === changeId),
          nameFleet,
          recordersShown ? names : null,
        ),
      ),
      recordersShown,
      page,
      pageSize,
      total: changeIds.length,
    };
  }

  /**
   * Lists an Armada's requests, for its managers.
   *
   * @param armada - The Armada.
   * @param userId - The reader.
   * @param query - Which status, and which page.
   * @returns The requests, newest first.
   */
  async requests(
    armada: StoArmadaEntity,
    userId: string,
    query: ArmadaRequestQueryDto,
  ): Promise<ArmadaRequestPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const [requests, total] = await this._dataSource.manager.findAndCount(
      ArmadaJoinRequestEntity,
      {
        where: {
          armadaId: armada.id,
          status: query.status ?? ArmadaJoinRequestStatus.PENDING,
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      },
    );

    return {
      items: await this.describeRequests(requests, userId),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Describes a Fleet's Armada for its page.
   *
   * @param fleet - The Fleet, which the reader may see.
   * @param userId - The reader, or null when signed out.
   * @returns Where it sits and, for somebody who may ask to join, their
   *   requests and choices.
   */
  async fleetView(
    fleet: StoFleetEntity,
    userId: string | null,
  ): Promise<FleetArmadaViewDto> {
    const manager = this._dataSource.manager;
    const placement = await openPlacementOf(manager, fleet.id);
    const mayRequest =
      fleet.status === FleetScopeStatus.ACTIVE &&
      ((
        await this._authorisation.authorise(userId, {
          kind: FleetScopeKind.FLEET,
          id: fleet.id,
        })
      )?.capabilities.has(FLEET_CAPABILITIES.ARMADA_REQUEST) ??
        false);
    const view: FleetArmadaViewDto = {
      placement:
        placement === null ? null : await this.placementOf(placement, userId),
      mayRequest,
      openRequest: null,
      lastAnswered: null,
      choices: [],
      cannotRequestBecause: null,
    };

    if (!mayRequest) {
      return view;
    }

    const requests = await manager.find(ArmadaJoinRequestEntity, {
      where: { fleetId: fleet.id },
      order: { createdAt: 'DESC' },
      take: 2,
    });
    const described = await this.describeRequests(requests, userId);
    const open = described.find(
      request => request.status === ArmadaJoinRequestStatus.PENDING,
    );

    view.openRequest = open ?? null;
    view.lastAnswered =
      described.find(
        request => request.status !== ArmadaJoinRequestStatus.PENDING,
      ) ?? null;

    if (placement === null && open === undefined) {
      view.cannotRequestBecause = await this.cannotRequest(fleet);
      view.choices =
        view.cannotRequestBecause === null ? await this.choicesFor(fleet) : [];
    }

    return view;
  }

  /**
   * Describes a Community's Armadas and the Fleets in none, for its page.
   *
   * @param community - The Community, which the reader may see.
   * @param userId - The reader, or null when signed out.
   * @returns Each open Armada with its shape, and the open Fleets the reader
   *   may see that sit in no Armada.
   */
  async communityStructure(
    community: FleetCommunityEntity,
    userId: string | null,
  ): Promise<CommunityStructureDto> {
    const manager = this._dataSource.manager;
    const [armadas, fleets, placements] = await Promise.all([
      manager.find(StoArmadaEntity, {
        where: {
          communityId: community.id,
          status: FleetScopeStatus.ACTIVE,
          deletedAt: IsNull(),
        },
        order: { exactGameName: 'ASC' },
      }),
      manager.find(StoFleetEntity, {
        where: {
          communityId: community.id,
          status: FleetScopeStatus.ACTIVE,
          deletedAt: IsNull(),
        },
        order: { exactGameName: 'ASC' },
      }),
      manager.find(ArmadaFleetMembershipEntity, {
        where: {
          communityId: community.id,
          validTo: IsNull(),
          deletedAt: IsNull(),
        },
      }),
    ]);
    const placed = new Set(placements.map(placement => placement.fleetId));
    const nameFleet = await this.namer(
      [
        ...fleets.map(fleet => fleet.id),
        ...placements.map(placement => placement.fleetId),
      ],
      userId,
    );
    const refs = await this.armadaRefs(armadas);

    return {
      armadas: armadas.map((armada, index) => ({
        armada: refs[index],
        structure: this.structureOf(
          placements.filter(placement => placement.armadaId === armada.id),
          nameFleet,
        ),
      })),
      standaloneFleets: fleets
        .filter(fleet => !placed.has(fleet.id))
        .map(fleet => nameFleet(fleet.id))
        .filter(ref => ref.id !== null),
    };
  }

  /**
   * Describes requests, naming who made and answered them.
   *
   * @param requests - The requests.
   * @param userId - The reader, for which Fleets they may see.
   * @returns The requests.
   */
  async describeRequests(
    requests: readonly ArmadaJoinRequestEntity[],
    userId: string | null,
  ): Promise<ArmadaRequestDto[]> {
    if (requests.length === 0) {
      return [];
    }

    const manager = this._dataSource.manager;
    const [names, armadas, nameFleet] = await Promise.all([
      usernamesFor(
        manager,
        requests.flatMap(request => [
          request.requestedByUserId,
          request.answeredByUserId,
        ]),
      ),
      manager.find(StoArmadaEntity, {
        where: { id: In(requests.map(request => request.armadaId)) },
      }),
      this.namer(
        requests.map(request => request.fleetId),
        userId,
      ),
    ]);
    const refs = await this.armadaRefs(armadas);
    const now = Date.now();

    return requests.map(request => ({
      id: request.id,
      status:
        request.status === ArmadaJoinRequestStatus.PENDING &&
        request.expiresAt.getTime() <= now
          ? ArmadaJoinRequestStatus.LAPSED
          : request.status,
      armada: refs[
        armadas.findIndex(armada => armada.id === request.armadaId)
      ] as ArmadaRefDto,
      fleet: nameFleet(request.fleetId),
      requestedBy:
        request.requestedByUserId === null
          ? null
          : (names.get(request.requestedByUserId) ?? null),
      message: request.message,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      answeredAt: request.answeredAt,
      answeredBy:
        request.answeredByUserId === null
          ? null
          : (names.get(request.answeredByUserId) ?? null),
      reason: request.reason,
    }));
  }

  /**
   * Names Armadas, with their platform and allegiance.
   *
   * @param armadas - The Armadas.
   * @returns Each one's reference, in the same order.
   */
  async armadaRefs(
    armadas: readonly StoArmadaEntity[],
  ): Promise<ArmadaRefDto[]> {
    const manager = this._dataSource.manager;
    const [platforms, factions] = await Promise.all([
      manager.find(PlatformEntity),
      manager.find(GeneralFactionEntity),
    ]);

    return armadas.map(armada => ({
      id: armada.id,
      name: armada.exactGameName,
      slug: armada.slug,
      platformSegment: toPlatformSegment(
        platforms.find(platform => platform.id === armada.platformId)?.name ??
          '',
      ),
      allegiance:
        factions.find(faction => faction.id === armada.allegianceFactionId)
          ?.name ?? null,
    }));
  }

  /**
   * Arranges placements as a tree.
   *
   * @param placements - One Armada's open placements.
   * @param nameFleet - Names Fleets for the reader.
   * @returns The Alpha, and each Beta with its Gammas, in the order placed.
   */
  private structureOf(
    placements: readonly ArmadaFleetMembershipEntity[],
    nameFleet: FleetNamer,
  ): ArmadaStructureDto {
    const slots = arrangementOf(placements);
    const node = (placement: ArmadaFleetMembershipEntity): ArmadaNodeDto => ({
      fleet: nameFleet(placement.fleetId),
      position: placement.position,
      since: placement.validFrom,
    });
    const alpha = placements.find(
      placement => placement.position === ArmadaPosition.ALPHA,
    );

    return {
      alpha: alpha === undefined ? null : node(alpha),
      betas: placements
        .filter(placement => placement.position === ArmadaPosition.BETA)
        .map(beta => ({
          ...node(beta),
          gammas: placements
            .filter(
              placement =>
                placement.position === ArmadaPosition.GAMMA &&
                slots.get(placement.fleetId)?.parentFleetId === beta.fleetId,
            )
            .map(node),
        })),
      maxBetas: MAX_ARMADA_BETAS,
      maxGammasPerBeta: MAX_ARMADA_GAMMAS_PER_BETA,
    };
  }

  /**
   * Describes where a Fleet sits.
   *
   * @param placement - Its open placement.
   * @param userId - The reader.
   * @returns The placement.
   */
  private async placementOf(
    placement: ArmadaFleetMembershipEntity,
    userId: string | null,
  ): Promise<FleetArmadaViewDto['placement']> {
    const manager = this._dataSource.manager;
    const placements = await openPlacements(manager, placement.armadaId);
    const slot = arrangementOf(placements).get(placement.fleetId);
    const parentId = slot?.parentFleetId ?? null;
    const [armada] = await manager.find(StoArmadaEntity, {
      where: { id: placement.armadaId },
    });
    const [ref] = await this.armadaRefs([armada]);
    const nameFleet = await this.namer(
      parentId === null ? [] : [parentId],
      userId,
    );

    return {
      armada: ref,
      position: placement.position,
      parent: parentId === null ? null : nameFleet(parentId),
      since: placement.validFrom,
      gammaCount: placements.filter(
        other => other.parentMembershipId === placement.id,
      ).length,
    };
  }

  /**
   * Says why a Fleet cannot ask to join any Armada, where it cannot.
   *
   * @param fleet - The Fleet.
   * @returns The reason, or null when it can.
   */
  private async cannotRequest(fleet: StoFleetEntity): Promise<string | null> {
    const faction =
      fleet.allegianceFactionId === null
        ? null
        : await this._dataSource.manager.findOne(GeneralFactionEntity, {
            where: { id: fleet.allegianceFactionId },
          });

    if (faction === null || !ARMADA_ALLEGIANCES.includes(faction.name)) {
      return (
        'An Armada is Federation or Klingon, and this Fleet’s allegiance is ' +
        'not set to either. Set it in the Fleet’s settings first.'
      );
    }

    return null;
  }

  /**
   * The Armadas a Fleet may ask to join.
   *
   * @param fleet - The Fleet.
   * @returns The open Armadas of its Community on its platform with its
   *   allegiance, by name.
   */
  private async choicesFor(fleet: StoFleetEntity): Promise<ArmadaRefDto[]> {
    return this.armadaRefs(
      await this._dataSource.manager.find(StoArmadaEntity, {
        where: {
          communityId: fleet.communityId as string,
          platformId: fleet.platformId,
          allegianceFactionId: fleet.allegianceFactionId as string,
          status: FleetScopeStatus.ACTIVE,
          deletedAt: IsNull(),
        },
        order: { exactGameName: 'ASC' },
      }),
    );
  }

  /**
   * Puts one change as the history shows it.
   *
   * @param actions - Its rows.
   * @param nameFleet - Names Fleets for the reader.
   * @param names - Usernames, or null when the reader is not shown them.
   * @returns The change.
   */
  private describeChange(
    actions: readonly ArmadaActionEntity[],
    nameFleet: FleetNamer,
    names: ReadonlyMap<string, string> | null,
  ): ArmadaChangeDto {
    const [first] = actions;
    const place = (position: ArmadaPosition | null, parentId: string | null) =>
      position === null
        ? null
        : {
            position,
            parent: parentId === null ? null : nameFleet(parentId),
          };

    return {
      changeId: first.changeId,
      at: first.createdAt,
      recordedBy:
        names === null || first.actorUserId === null
          ? null
          : (names.get(first.actorUserId) ?? null),
      reason: names === null ? null : first.reason,
      moves: actions.map(action => ({
        fleet: nameFleet(action.fleetId),
        action: action.action,
        from: place(action.fromPosition, action.fromParentFleetId),
        to: place(action.toPosition, action.toParentFleetId),
      })),
    };
  }

  /**
   * Whether a reader counts as an Armada's member for its pages.
   *
   * @param authorisation - What the policy concluded about them there.
   * @returns True for a member through a placed Fleet, or a role holder.
   */
  private isMember(
    authorisation: Awaited<ReturnType<FleetAuthorisationService['authorise']>>,
  ): boolean {
    return (
      authorisation !== null &&
      (authorisation.isApprovedMember || authorisation.roles.size > 0)
    );
  }

  /**
   * Builds a namer for some Fleets, hiding those the reader may not see.
   *
   * @param fleetIds - The Fleets, repeats allowed.
   * @param userId - The reader, or null when signed out.
   * @returns A function naming one.
   */
  private async namer(
    fleetIds: readonly string[],
    userId: string | null,
  ): Promise<FleetNamer> {
    const ids = [...new Set(fleetIds)];
    const fleets =
      ids.length === 0
        ? []
        : await this._dataSource.manager.find(StoFleetEntity, {
            where: { id: In(ids) },
            relations: { platform: true },
          });
    const visible = new Set<string>();

    for (const fleet of fleets) {
      if (
        await this._audience.canViewScope(
          { kind: FleetScopeKind.FLEET, id: fleet.id },
          userId,
        )
      ) {
        visible.add(fleet.id);
      }
    }

    const byId = new Map(fleets.map(fleet => [fleet.id, fleet]));

    return fleetId => {
      const fleet = byId.get(fleetId);
      const shown = fleet !== undefined && visible.has(fleetId);

      return {
        id: shown ? fleet.id : null,
        name: shown ? fleet.exactGameName : null,
        slug: shown ? fleet.slug : null,
        platformSegment: toPlatformSegment(fleet?.platform?.name ?? ''),
      };
    };
  }
}
