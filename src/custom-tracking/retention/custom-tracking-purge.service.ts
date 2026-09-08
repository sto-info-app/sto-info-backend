import { Injectable } from '@nestjs/common';

import { DataSource, EntityManager, In, LessThan } from 'typeorm';

import { CUSTOM_TRACKING_PURGE_BATCH } from '../constants/custom-tracking-retention.constants';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingPolicyAcceptanceEntity } from '../entities/custom-tracking-policy-acceptance.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingValueOptionEntity } from '../entities/custom-tracking-value-option.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import { CustomTrackingPurgeSummary } from '../observability/custom-tracking-observability.service';
import { CustomTrackingImageCleanupService } from './custom-tracking-image-cleanup.service';

/** How many identifiers one `IN` clause is given at a time. */
const CHUNK_SIZE = 500;

/** Everything one purge is going to remove. */
interface CustomTrackingPurgeTargets {
  /** Sections to remove. */
  sectionIds: string[];
  /** Tabs to remove. */
  tabIds: string[];
  /** Fields to remove. */
  fieldIds: string[];
  /** Options to remove. */
  optionIds: string[];
  /** Answers to remove. */
  valueIds: string[];
  /** Members whose acceptance of the agreement goes with it. */
  acceptanceUserIds: string[];
  /** Rows left where they are because something surviving still needs them. */
  retained: number;
}

/**
 * Removing Custom Tracking data from the database for good.
 *
 * The deletion order here is not a preference. Most of the foreign keys
 * between these tables cascade and one — an answer's reference to the option
 * it selected — restricts, and the database is free to process a cascade's
 * branches in whatever order it likes. Deleting a Field and hoping is
 * therefore a coin toss: sometimes the answers go first and the options follow
 * them harmlessly, and sometimes the options are reached while an answer still
 * points at one, and the whole night's job fails on a constraint. Doing it
 * bottom-up in as many statements takes the coin out of it.
 *
 * The order is: the answers' option selections, then their pictures, then the
 * answers, then the options, then the Fields, then the Tabs, then the
 * Sections. Nothing is ever deleted while something that survives still refers
 * to it.
 *
 * Options are the exception that proves the rule. One that a surviving answer
 * still selected is kept past its own retention period, because the label it
 * holds is the only thing that can render that answer. It is counted rather
 * than forced, and it goes on the night the last answer needing it does.
 */
@Injectable()
export class CustomTrackingPurgeService {
  /**
   * Creates an instance of CustomTrackingPurgeService.
   *
   * @param _dataSource - Opens the transaction each purge runs in.
   * @param _imageCleanup - Queues the pictures the purge orphans.
   */
  constructor(
    private readonly _dataSource: DataSource,
    private readonly _imageCleanup: CustomTrackingImageCleanupService,
  ) {}

  /**
   * Removes what has been soft-deleted for longer than the retention period.
   *
   * Bounded per run. A mass deletion 180 days ago should not become one very
   * long night; what is left over is a day older tomorrow and goes then.
   *
   * @param threshold - The moment before which a deletion has expired.
   * @returns What was removed.
   */
  async purgeExpired(threshold: Date): Promise<CustomTrackingPurgeSummary> {
    return this._dataSource.transaction(async manager =>
      this.remove(
        manager,
        await this.expiredTargets(manager, threshold),
        CustomTrackingImageCleanupReason.RETENTION,
      ),
    );
  }

  /**
   * Removes everything belonging to members whose accounts are being erased.
   *
   * Called before the member's own row goes. The foreign keys would take most
   * of this with it, but "most" is the problem: the pictures live in
   * Cloudflare, and a cascade cannot queue them for deletion. Doing it here
   * means an erased account leaves nothing behind anywhere.
   *
   * Nothing is retained. Retention protects an answer's ability to render
   * itself, and there is no longer anybody to render it for.
   *
   * @param userIds - The members being erased.
   * @returns What was removed.
   */
  async purgeUsers(userIds: string[]): Promise<CustomTrackingPurgeSummary> {
    if (userIds.length === 0) {
      return this.emptySummary();
    }

    return this._dataSource.transaction(async manager =>
      this.remove(
        manager,
        await this.userTargets(manager, userIds),
        CustomTrackingImageCleanupReason.ACCOUNT_CLOSED,
      ),
    );
  }

  /**
   * Works out what has expired.
   *
   * Each table is asked about its own `deletedAt` rather than about its
   * parent's. Deleting a Section stamps every Tab and Field beneath it at the
   * same moment, precisely so that this query can be per-table: a Tab whose
   * only evidence of deletion was its Section's would be invisible here and
   * would sit in the table forever.
   *
   * @param manager - The transaction to read through.
   * @param threshold - The moment before which a deletion has expired.
   * @returns What to remove.
   */
  private async expiredTargets(
    manager: EntityManager,
    threshold: Date,
  ): Promise<CustomTrackingPurgeTargets> {
    const expired = {
      where: { deletedAt: LessThan(threshold) },
      withDeleted: true,
      select: { id: true },
      order: { deletedAt: 'ASC' as const },
      take: CUSTOM_TRACKING_PURGE_BATCH,
    };

    const sectionIds = await this.idsOf(
      manager.find(CustomTrackingSectionEntity, expired),
    );
    const tabIds = await this.idsOf(
      manager.find(CustomTrackingTabEntity, expired),
    );
    const fieldIds = await this.idsOf(
      manager.find(CustomTrackingFieldEntity, expired),
    );
    const expiredOptionIds = await this.idsOf(
      manager.find(CustomTrackingOptionEntity, expired),
    );

    // Every answer to an expired Field, whether or not the answer itself was
    // ever deleted: the Field is going, so nothing could read them again.
    const valueIds = await this.valueIdsOfFields(manager, fieldIds);
    const optionIds = await this.unreferencedOptions(
      manager,
      expiredOptionIds,
      valueIds,
    );

    return {
      sectionIds,
      tabIds,
      fieldIds,
      optionIds,
      valueIds,
      acceptanceUserIds: [],
      retained: expiredOptionIds.length - optionIds.length,
    };
  }

  /**
   * Works out what belongs to members being erased.
   *
   * @param manager - The transaction to read through.
   * @param userIds - The members being erased.
   * @returns What to remove.
   */
  private async userTargets(
    manager: EntityManager,
    userIds: string[],
  ): Promise<CustomTrackingPurgeTargets> {
    const sectionIds = await this.gather(userIds, chunk =>
      manager.find(CustomTrackingSectionEntity, {
        where: { userId: In(chunk) },
        withDeleted: true,
        select: { id: true },
      }),
    );
    const fieldIds = await this.gather(userIds, chunk =>
      manager.find(CustomTrackingFieldEntity, {
        where: { userId: In(chunk) },
        withDeleted: true,
        select: { id: true },
      }),
    );
    const tabIds = await this.gather(sectionIds, chunk =>
      manager.find(CustomTrackingTabEntity, {
        where: { sectionId: In(chunk) },
        withDeleted: true,
        select: { id: true },
      }),
    );
    const optionIds = await this.gather(fieldIds, chunk =>
      manager.find(CustomTrackingOptionEntity, {
        where: { fieldId: In(chunk) },
        withDeleted: true,
        select: { id: true },
      }),
    );

    return {
      sectionIds,
      tabIds,
      fieldIds,
      optionIds,
      valueIds: await this.valueIdsOfFields(manager, fieldIds),
      acceptanceUserIds: userIds,
      retained: 0,
    };
  }

  /**
   * Deletes everything a purge decided on, in an order no constraint objects
   * to.
   *
   * @param manager - The transaction to write in.
   * @param targets - What to remove.
   * @param reason - What to record against the pictures being orphaned.
   * @returns What was removed.
   */
  private async remove(
    manager: EntityManager,
    targets: CustomTrackingPurgeTargets,
    reason: CustomTrackingImageCleanupReason,
  ): Promise<CustomTrackingPurgeSummary> {
    const images = await this.queueImages(manager, targets.valueIds, reason);

    await this.deleteBy(
      manager,
      CustomTrackingValueOptionEntity,
      'valueId',
      targets.valueIds,
    );
    await this.deleteBy(
      manager,
      CustomTrackingImageValueEntity,
      'valueId',
      targets.valueIds,
    );

    const values = await this.deleteBy(
      manager,
      CustomTrackingValueEntity,
      'id',
      targets.valueIds,
    );
    const options = await this.deleteBy(
      manager,
      CustomTrackingOptionEntity,
      'id',
      targets.optionIds,
    );
    const fields = await this.deleteBy(
      manager,
      CustomTrackingFieldEntity,
      'id',
      targets.fieldIds,
    );
    const tabs = await this.deleteBy(
      manager,
      CustomTrackingTabEntity,
      'id',
      targets.tabIds,
    );
    const sections = await this.deleteBy(
      manager,
      CustomTrackingSectionEntity,
      'id',
      targets.sectionIds,
    );

    await this.deleteBy(
      manager,
      CustomTrackingPolicyAcceptanceEntity,
      'userId',
      targets.acceptanceUserIds,
    );

    return {
      sections,
      tabs,
      fields,
      options,
      values,
      images,
      retained: targets.retained,
    };
  }

  /**
   * Notes the pictures that are about to lose the only rows pointing at them.
   *
   * Read before the answers go and queued inside the same transaction, because
   * afterwards there is nothing left that knows the pictures exist.
   *
   * @param manager - The transaction to write in.
   * @param valueIds - The answers being removed.
   * @param reason - What to record against them.
   * @returns How many pictures were queued.
   */
  private async queueImages(
    manager: EntityManager,
    valueIds: string[],
    reason: CustomTrackingImageCleanupReason,
  ): Promise<number> {
    const rows = await this.gatherRows(valueIds, chunk =>
      manager.find(CustomTrackingImageValueEntity, {
        where: { valueId: In(chunk) },
        select: { cloudflareImageId: true },
      }),
    );
    const imageIds = rows.map(row => row.cloudflareImageId);

    await this._imageCleanup.enqueue(manager, imageIds, reason);

    return imageIds.length;
  }

  /**
   * Lists the options that no surviving answer still selects.
   *
   * An option a retained answer points at is kept, however long ago it was
   * deleted. The label it holds is the only thing that can render that answer,
   * and a referential constraint would refuse the deletion anyway — this is
   * what turns that refusal into a decision.
   *
   * @param manager - The transaction to read through.
   * @param optionIds - The options that have expired.
   * @param removedValueIds - The answers going in this same purge.
   * @returns The options that may go.
   */
  private async unreferencedOptions(
    manager: EntityManager,
    optionIds: string[],
    removedValueIds: string[],
  ): Promise<string[]> {
    const going = new Set(removedValueIds);
    const references = await this.gatherRows(optionIds, chunk =>
      manager.find(CustomTrackingValueOptionEntity, {
        where: { optionId: In(chunk) },
        select: { optionId: true, valueId: true },
      }),
    );

    const spokenFor = new Set(
      references
        .filter(reference => !going.has(reference.valueId))
        .map(reference => reference.optionId),
    );

    return optionIds.filter(optionId => !spokenFor.has(optionId));
  }

  /**
   * Lists every answer recorded against some Fields.
   *
   * @param manager - The transaction to read through.
   * @param fieldIds - The Fields.
   * @returns The answers' identifiers.
   */
  private async valueIdsOfFields(
    manager: EntityManager,
    fieldIds: string[],
  ): Promise<string[]> {
    return this.gather(fieldIds, chunk =>
      manager.find(CustomTrackingValueEntity, {
        where: { fieldId: In(chunk) },
        withDeleted: true,
        select: { id: true },
      }),
    );
  }

  /**
   * Deletes rows by one column, a chunk of values at a time.
   *
   * @param manager - The transaction to write in.
   * @param entity - The table.
   * @param column - The column to match.
   * @param ids - The values to match it against.
   * @returns How many rows went.
   */
  private async deleteBy<T extends object>(
    manager: EntityManager,
    entity: new () => T,
    column: string,
    ids: string[],
  ): Promise<number> {
    let removed = 0;

    for (const chunk of this.chunked(ids)) {
      const result = await manager.delete(entity, { [column]: In(chunk) });

      removed += result.affected ?? 0;
    }

    return removed;
  }

  /**
   * Runs a query once per chunk of identifiers and collects the rows.
   *
   * @param ids - The identifiers to look up.
   * @param query - What to ask for one chunk of them.
   * @returns Every row from every chunk.
   */
  private async gatherRows<T>(
    ids: string[],
    query: (chunk: string[]) => Promise<T[]>,
  ): Promise<T[]> {
    const rows: T[] = [];

    for (const chunk of this.chunked(ids)) {
      rows.push(...(await query(chunk)));
    }

    return rows;
  }

  /**
   * Runs a query once per chunk of identifiers and collects the row
   * identifiers.
   *
   * @param ids - The identifiers to look up.
   * @param query - What to ask for one chunk of them.
   * @returns The identifiers of every row found.
   */
  private async gather(
    ids: string[],
    query: (chunk: string[]) => Promise<{ id: string }[]>,
  ): Promise<string[]> {
    return this.idsOf(this.gatherRows(ids, query));
  }

  /**
   * Reduces found rows to their identifiers.
   *
   * @param rows - The rows, still being fetched.
   * @returns Their identifiers.
   */
  private async idsOf(rows: Promise<{ id: string }[]>): Promise<string[]> {
    return (await rows).map(row => row.id);
  }

  /**
   * Splits identifiers into groups small enough for one statement.
   *
   * PostgreSQL takes a bounded number of parameters, and a purge after a mass
   * deletion is exactly the occasion that would exceed it. An empty list
   * yields no chunks, so callers never issue a statement matching nothing.
   *
   * @param ids - The identifiers.
   * @returns The groups.
   */
  private chunked(ids: string[]): string[][] {
    const chunks: string[][] = [];

    for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
      chunks.push(ids.slice(index, index + CHUNK_SIZE));
    }

    return chunks;
  }

  /**
   * A summary of a purge that had nothing to do.
   *
   * @returns Zero of everything.
   */
  private emptySummary(): CustomTrackingPurgeSummary {
    return {
      sections: 0,
      tabs: 0,
      fields: 0,
      options: 0,
      values: 0,
      images: 0,
      retained: 0,
    };
  }
}
