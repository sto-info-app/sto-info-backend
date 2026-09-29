import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, IsNull } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { toPlatformSegment } from '../../utilities/platform-segment.utility';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';

/** How each position reads in a sentence. */
export const ARMADA_POSITION_NAMES: Readonly<Record<ArmadaPosition, string>> = {
  [ArmadaPosition.ALPHA]: 'the Alpha',
  [ArmadaPosition.BETA]: 'a Beta',
  [ArmadaPosition.GAMMA]: 'a Gamma',
};

/**
 * Tells people in-app what became of their Armada requests, and when their
 * Fleet is taken out of an Armada (FC-025).
 *
 * Steve's decisions of 28 September 2026: the requester hears of an approval,
 * a rejection with its reason, and a lapse; a removed Fleet's Owner and
 * Admins hear of the removal, with its reason. Nobody is told of a new
 * request: the Armada's managers see it on its Requests tab.
 *
 * Sent after the change is committed. A notification that fails does not
 * undo anything, since the Fleet's page shows the outcome either way.
 */
@Injectable()
export class ArmadaNotifierService {
  private readonly _logger = new Logger(ArmadaNotifierService.name);

  /**
   * Creates an instance of ArmadaNotifierService.
   *
   * @param _dataSource - The database.
   * @param _notificationService - Sends notifications.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Tells the requester their request was approved.
   *
   * @param request - The request.
   * @param position - Where the Fleet was placed.
   */
  async approved(
    request: ArmadaJoinRequestEntity,
    position: ArmadaPosition,
  ): Promise<void> {
    await this.toRequester(request, (fleet, armada) => ({
      title: `${fleet} joined ${armada}`,
      body:
        `Your request for ${fleet} to join ${armada} was approved. It is ` +
        `${ARMADA_POSITION_NAMES[position]} there.`,
      severity: NotificationSeverity.SUCCESS,
    }));
  }

  /**
   * Tells the requester their request was rejected, and why.
   *
   * @param request - The request, with its reason.
   */
  async rejected(request: ArmadaJoinRequestEntity): Promise<void> {
    await this.toRequester(request, (fleet, armada) => ({
      title: `${armada} did not take ${fleet}`,
      body:
        `Your request for ${fleet} to join ${armada} was rejected. ` +
        `Reason: ${request.reason ?? ''}`,
      severity: NotificationSeverity.INFO,
    }));
  }

  /**
   * Tells the requester their request lapsed unanswered.
   *
   * @param request - The request.
   */
  async lapsed(request: ArmadaJoinRequestEntity): Promise<void> {
    await this.toRequester(request, (fleet, armada) => ({
      title: `Your request to join ${armada} lapsed`,
      body:
        `Nobody answered the request for ${fleet} to join ${armada}, so ` +
        `it lapsed. You can ask again from the Fleet’s page.`,
      severity: NotificationSeverity.INFO,
    }));
  }

  /**
   * Tells each removed Fleet's Owner and Admins, and why.
   *
   * @param armadaId - The Armada.
   * @param fleetIds - The Fleets removed.
   * @param reason - Why.
   * @param actorUserId - Who removed them, who is not told.
   */
  async removed(
    armadaId: string,
    fleetIds: readonly string[],
    reason: string,
    actorUserId: string,
  ): Promise<void> {
    const manager = this._dataSource.manager;
    const armada = await manager.findOne(StoArmadaEntity, {
      where: { id: armadaId },
    });

    for (const fleetId of fleetIds) {
      const fleet = await this.fleetWithLink(fleetId);

      if (armada === null || fleet === null) {
        continue;
      }

      const admins = await manager.find(ScopeRoleAssignmentEntity, {
        where: [
          {
            communityId: fleet.fleet.communityId as string,
            fleetId,
            role: FleetScopeRole.ADMIN,
            validTo: IsNull(),
            deletedAt: IsNull(),
          },
          {
            communityId: fleet.fleet.communityId as string,
            fleetId: IsNull(),
            armadaId: IsNull(),
            role: FleetScopeRole.ADMIN,
            validTo: IsNull(),
            deletedAt: IsNull(),
          },
        ],
      });
      const recipients = new Set(
        [fleet.ownerUserId, ...admins.map(admin => admin.userId)].filter(
          (userId): userId is string => userId !== null,
        ),
      );

      recipients.delete(actorUserId);

      for (const userId of recipients) {
        await this.send(userId, {
          title: `${fleet.fleet.exactGameName} was taken out of ${armada.exactGameName}`,
          body:
            `${fleet.fleet.exactGameName} is no longer in ` +
            `${armada.exactGameName}. Reason: ${reason}`,
          severity: NotificationSeverity.WARNING,
          linkUrl: fleet.link,
        });
      }
    }
  }

  /**
   * Sends one notification to a request's maker.
   *
   * @param request - The request.
   * @param compose - Builds it from the Fleet's and the Armada's names.
   */
  private async toRequester(
    request: ArmadaJoinRequestEntity,
    compose: (
      fleet: string,
      armada: string,
    ) => { title: string; body: string; severity: NotificationSeverity },
  ): Promise<void> {
    if (request.requestedByUserId === null) {
      return;
    }

    const [fleet, armada] = await Promise.all([
      this.fleetWithLink(request.fleetId),
      this._dataSource.manager.findOne(StoArmadaEntity, {
        where: { id: request.armadaId },
      }),
    ]);

    if (fleet === null || armada === null) {
      return;
    }

    await this.send(request.requestedByUserId, {
      ...compose(fleet.fleet.exactGameName, armada.exactGameName),
      linkUrl: fleet.link,
    });
  }

  /**
   * Reads a Fleet with the address of its page.
   *
   * @param fleetId - The Fleet.
   * @returns It, its Community's Owner and its link, or null when gone.
   */
  private async fleetWithLink(fleetId: string): Promise<{
    fleet: StoFleetEntity;
    ownerUserId: string | null;
    link: string | null;
  } | null> {
    const manager = this._dataSource.manager;
    const fleet = await manager.findOne(StoFleetEntity, {
      where: { id: fleetId },
      relations: { platform: true },
    });
    const community =
      fleet?.communityId == null
        ? null
        : await manager.findOne(FleetCommunityEntity, {
            where: { id: fleet.communityId },
          });

    if (!fleet || !community) {
      return null;
    }

    const frontendUrl = process.env.APP_FRONTEND_URL;

    return {
      fleet,
      ownerUserId: community.ownerUserId,
      link: frontendUrl
        ? `${frontendUrl}/fleets/communities/${community.slug}/fleets/` +
          `${toPlatformSegment(fleet.platform.name)}/${fleet.slug}`
        : null,
    };
  }

  /**
   * Sends one notification, logging rather than throwing on failure.
   *
   * @param userId - Who.
   * @param notification - What.
   * @param notification.title - Its title.
   * @param notification.body - Its text.
   * @param notification.severity - How it is shown.
   * @param notification.linkUrl - Where it leads, if anywhere.
   */
  private async send(
    userId: string,
    notification: {
      title: string;
      body: string;
      severity: NotificationSeverity;
      linkUrl: string | null;
    },
  ): Promise<void> {
    const { linkUrl, ...rest } = notification;

    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId,
        ...rest,
        ...(linkUrl === null ? {} : { linkUrl }),
      });
    } catch (error) {
      this._logger.warn(
        `[send] An Armada notification was not sent - UserId: ${userId}, ` +
          `Reason: ${(error as Error).name}`,
      );
    }
  }
}
