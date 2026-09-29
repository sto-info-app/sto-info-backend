import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager } from 'typeorm';

import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';
import { RecordAttendanceDto } from '../dto/scope-event.dto';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventAttendanceEntity } from '../entities/scope-event-attendance.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import {
  OccurrenceStatus,
  ScopeEventActionKind,
} from '../enums/scope-event.enums';
import { scopeMemberIds } from '../utilities/event-members.utility';
import {
  findEventInScope,
  findOccurrenceOf,
} from '../utilities/event-scope.utility';
import { ScopeEventAccessService } from './scope-event-access.service';
import { ScopeEventRsvpService } from './scope-event-rsvp.service';

/**
 * Who actually came to an occurrence (FC-028).
 *
 * Steve's decisions of 28 September 2026: an `events.manage` holder marks
 * each person attended or absent once the occurrence has started — anybody
 * who answered, or any of the scope's members who did not. The Character
 * recorded is the one they answered with, if it is still theirs: a manager
 * never picks another person's. It is kept apart from the answer and never
 * worked out from it, and only the managers and the person see it.
 * Recording is allowed after the scope closes, since it is the record of
 * what happened.
 */
@Injectable()
export class ScopeEventAttendanceService {
  /**
   * Creates an instance of ScopeEventAttendanceService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who runs a scope's events.
   * @param _rsvps - Checks whose Characters are whose.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ScopeEventAccessService,
    private readonly _rsvps: ScopeEventRsvpService,
  ) {}

  /**
   * Records whether somebody came.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param dto - Who, and whether they came.
   * @param managerId - The manager recording it.
   * @throws ForbiddenException when the caller does not run the events.
   * @throws NotFoundException when there is no such occurrence here.
   * @throws BadRequestException when they neither answered nor are one of
   *   the scope's members.
   * @throws ConflictException when the occurrence was cancelled or has not
   *   started.
   */
  async record(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    dto: RecordAttendanceDto,
    managerId: string,
  ): Promise<void> {
    const viewer = await this._access.viewerAt(scope, managerId);

    if (!viewer.mayManage) {
      throw new ForbiddenException('Only its event managers may do that.');
    }

    await this._dataSource.transaction(async manager => {
      await findEventInScope(manager, scope, eventId);

      const occurrence = await findOccurrenceOf(manager, eventId, occurrenceId);

      if (occurrence.status === OccurrenceStatus.CANCELLED) {
        throw new ConflictException('This occurrence was cancelled.');
      }

      if (occurrence.startsAt > new Date()) {
        throw new ConflictException(
          'Attendance is recorded once it has started.',
        );
      }

      const answer = await manager.findOne(ScopeEventRsvpEntity, {
        where: { occurrenceId, userId: dto.userId },
      });

      if (
        answer === null &&
        !(await scopeMemberIds(manager, scope)).includes(dto.userId)
      ) {
        throw new BadRequestException(
          'They neither answered nor are one of its members.',
        );
      }

      const characterId = await this.theirCharacter(
        manager,
        answer?.characterId ?? null,
        dto.userId,
      );

      const record =
        (await manager.findOne(ScopeEventAttendanceEntity, {
          where: { occurrenceId, userId: dto.userId },
        })) ??
        manager.create(ScopeEventAttendanceEntity, {
          occurrenceId,
          userId: dto.userId,
        });

      record.attended = dto.attended;
      record.characterId = characterId;
      record.recordedByUserId = managerId;
      await manager.save(ScopeEventAttendanceEntity, record);
      await manager.save(ScopeEventActionEntity, {
        eventId,
        occurrenceId,
        action: ScopeEventActionKind.ATTENDANCE_RECORDED,
        actorUserId: managerId,
        subjectUserId: dto.userId,
        detail: { attended: dto.attended },
      });
    });
  }

  /**
   * The Character to record: the one they answered with, while it is still
   * theirs.
   *
   * @param manager - The transaction.
   * @param characterId - The Character they answered with, if any.
   * @param userId - Who.
   * @returns The Character, or null.
   */
  private async theirCharacter(
    manager: EntityManager,
    characterId: string | null,
    userId: string,
  ): Promise<string | null> {
    if (characterId === null) {
      return null;
    }

    try {
      await this._rsvps.assertOwnCharacter(manager, characterId, userId);

      return characterId;
    } catch {
      return null;
    }
  }
}
