import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { CharacterFleetMembershipService } from '../../services/character-fleet-membership.service';
import {
  AnswerOccurrenceDto,
  MyAnswerDto,
  OccurrenceCountsDto,
  OccurrencePersonDto,
} from '../dto/scope-event.dto';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { OccurrenceStatus, RsvpResponse } from '../enums/scope-event.enums';
import { queueNotices } from '../utilities/event-notices.utility';
import {
  assertEventActive,
  assertOccurrenceAhead,
  assertScopeOpen,
  findEventInScope,
  findOccurrenceOf,
} from '../utilities/event-scope.utility';
import { ScopeEventAccessService } from './scope-event-access.service';

/** What to say to somebody answering an occurrence that has started. */
const ANSWERS_CLOSED = 'This has started, so answers are closed.';

/** The order people are listed in: those with a place, waiting, maybe, not. */
const LIST_ORDER: Readonly<Record<RsvpResponse, number>> = {
  [RsvpResponse.GOING]: 0,
  [RsvpResponse.MAYBE]: 2,
  [RsvpResponse.NOT_GOING]: 3,
};

/**
 * Answers to an event's occurrences, and its waitlist (FC-028).
 *
 * With Steve's decisions of 28 September 2026: Going, Maybe or Can't go,
 * with a Character of the answerer's own; open until the occurrence starts;
 * one answer per person. Beyond an event's capacity, Going waits for a
 * place, and Maybe takes none. When a place comes free the earliest waiting
 * is given it and told, until the occurrence starts.
 *
 * Every change to an occurrence's answers is made under a lock on the
 * occurrence, so two people taking the last place are decided one after the
 * other, and a repeated request finds its own answer already there.
 */
@Injectable()
export class ScopeEventRsvpService {
  /**
   * Creates an instance of ScopeEventRsvpService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who may see and answer an event.
   * @param _characters - Says whose Characters are whose.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ScopeEventAccessService,
    private readonly _characters: CharacterFleetMembershipService,
  ) {}

  /**
   * Answers an occurrence, or changes an answer.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param userId - The person answering.
   * @param dto - Their answer, and a Character of theirs.
   * @returns Their answer as it now stands.
   * @throws NotFoundException when there is no such occurrence they may see.
   * @throws ForbiddenException when they may not answer it.
   * @throws BadRequestException when the Character is not theirs.
   * @throws ConflictException when the scope is closed, or the occurrence
   *   was cancelled or has started.
   */
  async answer(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    userId: string,
    dto: AnswerOccurrenceDto,
  ): Promise<MyAnswerDto> {
    const viewer = await this._access.viewerAt(scope, userId);

    return this._dataSource.transaction(async manager => {
      const { event, occurrence } = await this.answerable(
        manager,
        scope,
        eventId,
        occurrenceId,
        viewer,
      );
      const characterId = dto.characterId ?? null;

      if (characterId !== null) {
        await this.assertOwnCharacter(manager, characterId, userId);
      }

      const now = new Date();
      const existing = await manager.findOne(ScopeEventRsvpEntity, {
        where: { occurrenceId, userId },
      });

      if (
        existing?.response === dto.response &&
        existing.characterId === characterId
      ) {
        return (await this.mine(manager, occurrenceId, userId)) as MyAnswerDto;
      }

      const hadPlace = this.hasPlace(existing);
      const rsvp =
        existing ??
        manager.create(ScopeEventRsvpEntity, { occurrenceId, userId });

      rsvp.characterId = characterId;
      rsvp.waitlistedAt = await this.waitlistFor(
        manager,
        event,
        occurrenceId,
        existing,
        dto.response,
        now,
      );
      rsvp.response = dto.response;
      await manager.save(ScopeEventRsvpEntity, rsvp);

      if (hadPlace && !this.hasPlace(rsvp)) {
        await this.promote(manager, event, occurrence, now);
      }

      return (await this.mine(manager, occurrenceId, userId)) as MyAnswerDto;
    });
  }

  /**
   * Takes an answer back.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param userId - The person.
   * @throws NotFoundException when there is no such occurrence they may
   *   see, or no answer of theirs.
   * @throws ConflictException when the scope is closed, or the occurrence
   *   was cancelled or has started.
   */
  async withdraw(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    userId: string,
  ): Promise<void> {
    const viewer = await this._access.viewerAt(scope, userId);

    await this._dataSource.transaction(async manager => {
      const { event, occurrence } = await this.answerable(
        manager,
        scope,
        eventId,
        occurrenceId,
        viewer,
      );
      const existing = await manager.findOne(ScopeEventRsvpEntity, {
        where: { occurrenceId, userId },
      });

      if (existing === null) {
        throw new NotFoundException('You have not answered this.');
      }

      await manager.remove(ScopeEventRsvpEntity, existing);

      if (this.hasPlace(existing)) {
        await this.promote(manager, event, occurrence, new Date());
      }
    });
  }

  /**
   * Gives free places to the earliest waiting, and tells each.
   *
   * Nothing moves once the occurrence has started or been cancelled. An
   * event with no capacity has room for everyone waiting.
   *
   * @param manager - The transaction, holding the occurrence's lock.
   * @param event - The event, for its capacity.
   * @param occurrence - The occurrence.
   * @param now - The moment of the change.
   */
  async promote(
    manager: EntityManager,
    event: Pick<ScopeEventEntity, 'capacity'>,
    occurrence: ScopeEventOccurrenceEntity,
    now: Date,
  ): Promise<void> {
    if (
      occurrence.status !== OccurrenceStatus.SCHEDULED ||
      occurrence.startsAt <= now
    ) {
      return;
    }

    const waiting = await manager.find(ScopeEventRsvpEntity, {
      where: { occurrenceId: occurrence.id, waitlistedAt: Not(IsNull()) },
      order: { waitlistedAt: 'ASC', id: 'ASC' },
    });
    const free =
      event.capacity === null
        ? waiting.length
        : event.capacity - (await this.placesTaken(manager, occurrence.id));

    for (const rsvp of waiting.slice(0, Math.max(0, free))) {
      rsvp.waitlistedAt = null;
      await manager.save(ScopeEventRsvpEntity, rsvp);
      await queueNotices(
        manager,
        NotificationOutboxKind.EVENT_PROMOTED,
        occurrence,
        [rsvp.userId],
      );
    }
  }

  /**
   * Counts the answers to some occurrences.
   *
   * @param manager - The manager to read through.
   * @param occurrenceIds - The occurrences.
   * @param includeNotGoing - Whether to count Can't go, which only managers
   *   are shown.
   * @returns Each occurrence's counts.
   */
  async countsFor(
    manager: EntityManager,
    occurrenceIds: readonly string[],
    includeNotGoing: boolean,
  ): Promise<Map<string, OccurrenceCountsDto>> {
    const counts = new Map<string, OccurrenceCountsDto>(
      occurrenceIds.map(id => [
        id,
        {
          going: 0,
          maybe: 0,
          waitlisted: 0,
          notGoing: includeNotGoing ? 0 : null,
        },
      ]),
    );

    if (occurrenceIds.length === 0) {
      return counts;
    }

    const answers = await manager.find(ScopeEventRsvpEntity, {
      where: { occurrenceId: In([...occurrenceIds]) },
      select: { occurrenceId: true, response: true, waitlistedAt: true },
    });

    for (const answer of answers) {
      const tally = counts.get(answer.occurrenceId) as OccurrenceCountsDto;

      if (answer.response === RsvpResponse.MAYBE) {
        tally.maybe += 1;
      } else if (answer.response === RsvpResponse.NOT_GOING) {
        tally.notGoing = includeNotGoing
          ? (tally.notGoing as number) + 1
          : null;
      } else if (answer.waitlistedAt === null) {
        tally.going += 1;
      } else {
        tally.waitlisted += 1;
      }
    }

    return counts;
  }

  /**
   * Reads somebody's own answer to an occurrence.
   *
   * @param manager - The manager to read through.
   * @param occurrenceId - The occurrence.
   * @param userId - The person, or null when signed out.
   * @returns Their answer, or null when they have none.
   */
  async mine(
    manager: EntityManager,
    occurrenceId: string,
    userId: string | null,
  ): Promise<MyAnswerDto | null> {
    const rsvp =
      userId === null
        ? null
        : await manager.findOne(ScopeEventRsvpEntity, {
            where: { occurrenceId, userId },
          });

    if (rsvp === null) {
      return null;
    }

    return {
      response: rsvp.response,
      characterId: rsvp.characterId,
      waitlistPosition:
        rsvp.waitlistedAt === null
          ? null
          : (await this.waitingOf(manager, occurrenceId)).findIndex(
              waiting => waiting.id === rsvp.id,
            ) + 1,
    };
  }

  /**
   * Lists who answered an occurrence: those with a place in the order they
   * answered, then those waiting in their order, then Maybe, then Can't go.
   *
   * @param manager - The manager to read through.
   * @param occurrenceId - The occurrence.
   * @param includeNotGoing - Whether to list Can't go, for managers.
   * @returns The people.
   */
  async people(
    manager: EntityManager,
    occurrenceId: string,
    includeNotGoing: boolean,
  ): Promise<OccurrencePersonDto[]> {
    const answers = await manager.find(ScopeEventRsvpEntity, {
      where: {
        occurrenceId,
        ...(includeNotGoing ? {} : { response: Not(RsvpResponse.NOT_GOING) }),
      },
      order: { respondedAt: 'ASC', id: 'ASC' },
    });
    const names = await usernamesFor(
      manager,
      answers.map(answer => answer.userId),
    );
    const characters = await this.characterNames(
      manager,
      answers.map(answer => answer.characterId),
    );
    const rank = (answer: ScopeEventRsvpEntity): number =>
      answer.waitlistedAt === null ? LIST_ORDER[answer.response] : 1;

    return answers
      .map((answer, index) => ({ answer, index }))
      .sort(
        (a, b) =>
          rank(a.answer) - rank(b.answer) ||
          waitedSince(a.answer) - waitedSince(b.answer) ||
          a.index - b.index,
      )
      .map(({ answer }) => ({
        userId: answer.userId,
        username: names.get(answer.userId) ?? null,
        characterName:
          answer.characterId === null
            ? null
            : (characters.get(answer.characterId) ?? null),
        response: answer.response,
        waitlisted: answer.waitlistedAt !== null,
      }));
  }

  /**
   * Names some Characters by their full handle.
   *
   * @param manager - The manager to read through.
   * @param characterIds - The Characters, nulls allowed.
   * @returns Each one's full handle.
   */
  async characterNames(
    manager: EntityManager,
    characterIds: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(characterIds.filter((id): id is string => id !== null)),
    ];

    if (ids.length === 0) {
      return new Map();
    }

    const characters = await manager.find(CharacterEntity, {
      where: { id: In(ids) },
      select: { id: true, fullHandle: true },
    });

    return new Map(
      characters.map(character => [character.id, character.fullHandle]),
    );
  }

  /**
   * Requires that a Character is the person's own.
   *
   * @param manager - The transaction.
   * @param characterId - The Character.
   * @param userId - The person.
   * @throws BadRequestException when it is not, whether it exists or not.
   */
  async assertOwnCharacter(
    manager: EntityManager,
    characterId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this._characters.requireOwnedCharacter(
        manager,
        characterId,
        userId,
      );
    } catch {
      throw new BadRequestException('That Character is not one of theirs.');
    }
  }

  /**
   * Finds an occurrence somebody may answer now, holding it.
   *
   * @param manager - The transaction.
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param viewer - Who is answering.
   * @returns The event and the occurrence.
   */
  private async answerable(
    manager: EntityManager,
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    viewer: Awaited<ReturnType<ScopeEventAccessService['viewerAt']>>,
  ): Promise<{
    event: ScopeEventEntity;
    occurrence: ScopeEventOccurrenceEntity;
  }> {
    const event = await findEventInScope(manager, scope, eventId);

    if (!(await this._access.canSee(event, viewer))) {
      throw new NotFoundException('Not found');
    }

    const occurrence = await findOccurrenceOf(
      manager,
      eventId,
      occurrenceId,
      true,
    );

    if (!(await this._access.mayAnswer(event, viewer))) {
      throw new ForbiddenException('Only its members may answer this event.');
    }

    assertScopeOpen(scope, viewer);
    assertEventActive(event);
    assertOccurrenceAhead(occurrence, new Date(), ANSWERS_CLOSED);

    return { event, occurrence };
  }

  /**
   * Works out whether a Going answer has a place or waits for one.
   *
   * Somebody already Going keeps where they are, place or queue.
   *
   * @param manager - The transaction, holding the occurrence's lock.
   * @param event - The event, for its capacity.
   * @param occurrenceId - The occurrence.
   * @param existing - Their answer before, if any.
   * @param response - Their answer now.
   * @param now - The moment of the change.
   * @returns When they started waiting, or null when they have a place or
   *   are not Going.
   */
  private async waitlistFor(
    manager: EntityManager,
    event: ScopeEventEntity,
    occurrenceId: string,
    existing: ScopeEventRsvpEntity | null,
    response: RsvpResponse,
    now: Date,
  ): Promise<Date | null> {
    if (response !== RsvpResponse.GOING) {
      return null;
    }

    if (existing?.response === RsvpResponse.GOING) {
      return existing.waitlistedAt;
    }

    if (event.capacity === null) {
      return null;
    }

    const taken = await this.placesTaken(manager, occurrenceId);

    return taken >= event.capacity ? now : null;
  }

  /**
   * Counts the places taken on an occurrence.
   *
   * @param manager - The transaction.
   * @param occurrenceId - The occurrence.
   * @returns How many are Going with a place.
   */
  private placesTaken(
    manager: EntityManager,
    occurrenceId: string,
  ): Promise<number> {
    return manager.count(ScopeEventRsvpEntity, {
      where: {
        occurrenceId,
        response: RsvpResponse.GOING,
        waitlistedAt: IsNull(),
      },
    });
  }

  /**
   * Lists who is waiting, in order.
   *
   * @param manager - The manager to read through.
   * @param occurrenceId - The occurrence.
   * @returns Their answers, earliest first.
   */
  private waitingOf(
    manager: EntityManager,
    occurrenceId: string,
  ): Promise<ScopeEventRsvpEntity[]> {
    return manager.find(ScopeEventRsvpEntity, {
      where: { occurrenceId, waitlistedAt: Not(IsNull()) },
      order: { waitlistedAt: 'ASC', id: 'ASC' },
      select: { id: true },
    });
  }

  /**
   * Whether an answer holds a place.
   *
   * @param rsvp - The answer, or null.
   * @returns True when it is Going with a place.
   */
  private hasPlace(rsvp: ScopeEventRsvpEntity | null): boolean {
    return rsvp?.response === RsvpResponse.GOING && rsvp.waitlistedAt === null;
  }
}

/**
 * When an answer started waiting, for ordering; zero for one not waiting.
 *
 * @param answer - The answer.
 * @returns Milliseconds since the epoch, or zero.
 */
function waitedSince(answer: ScopeEventRsvpEntity): number {
  return answer.waitlistedAt?.getTime() ?? 0;
}
