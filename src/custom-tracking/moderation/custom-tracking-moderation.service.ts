import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DataSource, IsNull } from 'typeorm';

import { CustomTrackingSuppressionDto } from '../dto/custom-tracking-moderation.dto';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingModerationLevel } from '../enums/custom-tracking-moderation-level.enum';

/**
 * The columns every level an administrator can act on has in common.
 *
 * Structural rather than a base class, for the same reason the rest of this
 * hierarchy is: three tables that share four column names are not three
 * subtypes of anything.
 */
type CustomTrackingSuppressibleRow = {
  /** Unique identifier. */
  id: string;
  /** What the member called it. */
  name: string;
  /** When an administrator hid it, or null. */
  suppressedAt: Date | null;
  /** Which administrator hid it, or null. */
  suppressedByUserId: string | null;
  /** When its owner deleted it, or null while it is live. */
  deletedAt: Date | null;
};

/**
 * Hiding somebody's custom content from the public without deleting it.
 *
 * Suppression is not deletion and it is not a ban. It is the narrowest thing
 * that answers a report: the member keeps their data, keeps their account, and
 * keeps being able to edit what they wrote, and the rest of the world stops
 * seeing it. The two heavier instruments already exist — the member can be
 * disabled through the moderation module, which hides everything they have —
 * and the point of this one is that most reports do not warrant either.
 *
 * There is no interface for it. That is a deliberate limit rather than an
 * omission: individual-content reporting was deferred, so nothing routes a
 * complaint to a particular Section, and an administrator reaching these
 * routes has arrived from a report about a member and a page they have looked
 * at. Building a console for a queue that does not exist would be building the
 * wrong thing first.
 *
 * Nothing here reads or writes an answer. An administrator suppressing a Field
 * hides it for every Account and Character at once, which is what a report
 * about offending content actually asks for; suppressing one answer out of
 * forty would leave the other thirty-nine.
 */
@Injectable()
export class CustomTrackingModerationService {
  private readonly _logger = new Logger(CustomTrackingModerationService.name);

  /**
   * Creates an instance of CustomTrackingModerationService.
   *
   * @param _dataSource - Reads and writes whichever of the three tables the
   *   level names.
   */
  constructor(private readonly _dataSource: DataSource) {}

  /**
   * Hides one Section, Tab or Field from everybody but its owner.
   *
   * @param level - Which level is being acted on.
   * @param id - The row.
   * @param adminUserId - The administrator acting.
   * @returns Its state afterwards.
   * @throws NotFoundException when there is no such live row.
   */
  async suppress(
    level: CustomTrackingModerationLevel,
    id: string,
    adminUserId: string,
  ): Promise<CustomTrackingSuppressionDto> {
    this._logger.warn(
      `[moderation] Suppressing - Level: ${level}, Id: ${id}, AdminUserId: ${adminUserId}`,
    );

    return this.write(level, id, {
      suppressedAt: new Date(),
      suppressedByUserId: adminUserId,
    });
  }

  /**
   * Puts a suppressed Section, Tab or Field back into public view.
   *
   * The administrator who suppressed it is cleared along with the timestamp.
   * Who did what is in the audit trail, which is the record that survives; a
   * name left on a row that is no longer suppressed reads as though it still
   * were.
   *
   * @param level - Which level is being acted on.
   * @param id - The row.
   * @param adminUserId - The administrator acting.
   * @returns Its state afterwards.
   * @throws NotFoundException when there is no such live row.
   */
  async restore(
    level: CustomTrackingModerationLevel,
    id: string,
    adminUserId: string,
  ): Promise<CustomTrackingSuppressionDto> {
    this._logger.warn(
      `[moderation] Restoring - Level: ${level}, Id: ${id}, AdminUserId: ${adminUserId}`,
    );

    return this.write(level, id, {
      suppressedAt: null,
      suppressedByUserId: null,
    });
  }

  /**
   * Changes one row's suppression and reports what it now says.
   *
   * Read back rather than assembled from what was written. The row is what the
   * public projection will consult, and an administrator needs to be told what
   * it says rather than what we asked it to say.
   *
   * @param level - Which level is being acted on.
   * @param id - The row.
   * @param change - The new suppression state.
   * @returns Its state afterwards.
   * @throws NotFoundException when there is no such live row.
   */
  private async write(
    level: CustomTrackingModerationLevel,
    id: string,
    change: Pick<
      CustomTrackingSuppressibleRow,
      'suppressedAt' | 'suppressedByUserId'
    >,
  ): Promise<CustomTrackingSuppressionDto> {
    const entity = this.entityFor(level);
    const manager = this._dataSource.manager;

    // Deleted rows are matched out, so a Section its owner removed last week
    // cannot be suppressed. It is already invisible, and acting on it would
    // record a decision that changed nothing.
    const written = await manager.update(
      entity,
      { id, deletedAt: IsNull() },
      change,
    );

    if (!written.affected) {
      throw new NotFoundException('There is no such section, tab or field.');
    }

    const updated = (await manager.findOne(entity, {
      where: { id },
    })) as CustomTrackingSuppressibleRow;

    return {
      level,
      id: updated.id,
      name: updated.name,
      suppressed: updated.suppressedAt !== null,
      suppressedAt: updated.suppressedAt,
      suppressedByUserId: updated.suppressedByUserId,
    };
  }

  /**
   * The table a level names.
   *
   * @param level - The level.
   * @returns Its entity.
   */
  private entityFor(
    level: CustomTrackingModerationLevel,
  ): new () => CustomTrackingSuppressibleRow {
    if (level === CustomTrackingModerationLevel.SECTION) {
      return CustomTrackingSectionEntity;
    }

    if (level === CustomTrackingModerationLevel.TAB) {
      return CustomTrackingTabEntity;
    }

    return CustomTrackingFieldEntity;
  }
}
