import { Injectable, OnModuleInit } from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';
import {
  NotificationOutboxHandler,
  NotificationOutboxRegistry,
  OutboxMessage,
} from 'src/notification/outbox/notification-outbox.registry';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { CharacterFleetProposalEntity } from '../../entities/character-fleet-proposal.entity';
import { CharacterFleetProposalState } from '../../enums/character-fleet-proposal-status.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { toProposalState } from '../../utilities/character-fleet-proposal.utility';

/**
 * Tells somebody a Fleet has asked whether their Character is in it
 * (FC-029).
 *
 * Steve's decision of 28 September 2026: one notice per proposal, through
 * the outbox. It is written at delivery, from the proposal as it stands
 * then, and set aside if it was answered, withdrawn or has lapsed, if the
 * Character is no longer theirs, or if they may no longer see the Fleet —
 * a proposal is hidden from its owner for as long as that lasts.
 */
@Injectable()
export class ProposalNoticeHandler
  implements NotificationOutboxHandler, OnModuleInit
{
  readonly kinds = [NotificationOutboxKind.ROSTER_ASSOCIATION_PROPOSED];

  /**
   * Creates an instance of ProposalNoticeHandler.
   *
   * @param _registry - Where the outbox finds its handlers.
   * @param _audience - Says whether the owner may see the Fleet.
   */
  constructor(
    private readonly _registry: NotificationOutboxRegistry,
    private readonly _audience: FleetAudienceService,
  ) {}

  /** Registers with the outbox. */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Writes the notice, if the proposal is still waiting on this person.
   *
   * @param notice - The notice.
   * @param manager - The delivery's transaction.
   * @param now - The moment of the run.
   * @returns The message, or null to set it aside.
   */
  async compose(
    notice: NotificationOutboxEntity,
    manager: EntityManager,
    now: Date,
  ): Promise<OutboxMessage | null> {
    const proposal = await manager.findOne(CharacterFleetProposalEntity, {
      where: { id: notice.subjectId },
      relations: { character: { account: true }, fleet: true },
    });
    const account = proposal?.character?.account;

    if (
      !proposal?.fleet ||
      account?.userId !== notice.userId ||
      toProposalState(proposal, now) !== CharacterFleetProposalState.PENDING ||
      !(await this._audience.canViewScope(
        { kind: FleetScopeKind.FLEET, id: proposal.fleetId },
        notice.userId,
      ))
    ) {
      return null;
    }

    const { character, fleet } = proposal;
    const site = process.env.APP_FRONTEND_URL;
    const page =
      `/dashboard/accounts/${encodeURIComponent(account.handle.replaceAll('#', '~'))}` +
      `/${encodeURIComponent(character.handle)}`;

    return {
      title: `Is ${character.fullHandle} in ${fleet.exactGameName}?`,
      body:
        `${fleet.exactGameName} has asked whether ${character.fullHandle} ` +
        `is one of its members. Confirm or decline it on the Character’s ` +
        `page by ${dayOf(proposal.expiresAt)}.`,
      severity: NotificationSeverity.INFO,
      linkUrl: site ? `${site}${page}` : null,
    };
  }
}

/**
 * Names a deadline's day.
 *
 * @param instant - The deadline.
 * @returns Such as "28 October 2026".
 */
function dayOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);
}
