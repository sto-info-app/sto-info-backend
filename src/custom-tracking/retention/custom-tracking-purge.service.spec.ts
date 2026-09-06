import { jest } from '@jest/globals';
import { DataSource, EntityManager } from 'typeorm';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingPolicyAcceptanceEntity } from '../entities/custom-tracking-policy-acceptance.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingValueOptionEntity } from '../entities/custom-tracking-value-option.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import { CustomTrackingImageCleanupService } from './custom-tracking-image-cleanup.service';
import { CustomTrackingPurgeService } from './custom-tracking-purge.service';

describe('CustomTrackingPurgeService', () => {
  let service: CustomTrackingPurgeService;
  let rows: Map<unknown, unknown[]>;
  let find: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
  let remove: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let enqueue: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let manager: EntityManager;

  const threshold = new Date('2026-03-01T00:00:00.000Z');

  /**
   * Names the tables a delete was issued against, in the order it happened.
   *
   * @returns The entity names, in order.
   */
  const deletionOrder = (): string[] =>
    remove.mock.calls.map(call => (call[0] as { name: string }).name);

  beforeEach(() => {
    rows = new Map<unknown, unknown[]>();
    find = jest.fn(async (entity: unknown) => rows.get(entity) ?? []);
    remove = jest.fn(async () => ({ affected: 1 }));
    enqueue = jest.fn(async () => undefined);

    manager = { find, delete: remove } as unknown as EntityManager;

    service = new CustomTrackingPurgeService(
      {
        transaction: (body: (m: EntityManager) => Promise<unknown>) =>
          body(manager),
      } as unknown as DataSource,
      { enqueue } as unknown as CustomTrackingImageCleanupService,
    );
  });

  describe('purgeExpired', () => {
    it('removes what has been deleted for longer than the retention period', async () => {
      rows.set(CustomTrackingSectionEntity, [{ id: 'section-1' }]);
      rows.set(CustomTrackingTabEntity, [{ id: 'tab-1' }]);
      rows.set(CustomTrackingFieldEntity, [{ id: 'field-1' }]);
      rows.set(CustomTrackingValueEntity, [{ id: 'value-1' }]);

      const summary = await service.purgeExpired(threshold);

      expect(summary.sections).toBe(1);
      expect(summary.tabs).toBe(1);
      expect(summary.fields).toBe(1);
      expect(summary.values).toBe(1);
    });

    // The database is free to process a cascade's branches in whatever order
    // it likes, and one of those orders reaches an option while an answer
    // still points at it. Doing it bottom-up in as many statements is what
    // takes the coin out of it.
    it('deletes bottom-up, so nothing goes while something still refers to it', async () => {
      rows.set(CustomTrackingSectionEntity, [{ id: 'section-1' }]);
      rows.set(CustomTrackingTabEntity, [{ id: 'tab-1' }]);
      rows.set(CustomTrackingFieldEntity, [{ id: 'field-1' }]);
      rows.set(CustomTrackingOptionEntity, [{ id: 'option-1' }]);
      rows.set(CustomTrackingValueEntity, [{ id: 'value-1' }]);

      await service.purgeExpired(threshold);

      expect(deletionOrder()).toEqual([
        CustomTrackingValueOptionEntity.name,
        CustomTrackingImageValueEntity.name,
        CustomTrackingValueEntity.name,
        CustomTrackingOptionEntity.name,
        CustomTrackingFieldEntity.name,
        CustomTrackingTabEntity.name,
        CustomTrackingSectionEntity.name,
      ]);
    });

    it('reads each table by its own deletion date', async () => {
      await service.purgeExpired(threshold);

      expect(find).toHaveBeenCalledWith(
        CustomTrackingTabEntity,
        expect.objectContaining({ withDeleted: true }),
      );
    });

    // An option's label is the only thing that can render an answer that
    // selected it, so it outlives its own retention period for as long as one
    // does.
    it('keeps an option a surviving answer still selects', async () => {
      rows.set(CustomTrackingOptionEntity, [
        { id: 'option-1' },
        { id: 'option-2' },
      ]);
      rows.set(CustomTrackingValueOptionEntity, [
        { optionId: 'option-1', valueId: 'value-elsewhere' },
      ]);

      const summary = await service.purgeExpired(threshold);

      expect(summary.retained).toBe(1);
      expect(remove).toHaveBeenCalledWith(
        CustomTrackingOptionEntity,
        expect.objectContaining({ id: expect.anything() }),
      );
    });

    it('removes an option whose only answers are going in this same sweep', async () => {
      rows.set(CustomTrackingFieldEntity, [{ id: 'field-1' }]);
      rows.set(CustomTrackingOptionEntity, [{ id: 'option-1' }]);
      rows.set(CustomTrackingValueEntity, [{ id: 'value-1' }]);
      rows.set(CustomTrackingValueOptionEntity, [
        { optionId: 'option-1', valueId: 'value-1' },
      ]);

      const summary = await service.purgeExpired(threshold);

      expect(summary.retained).toBe(0);
      expect(summary.options).toBe(1);
    });

    // Read before the answers go and queued inside the same transaction:
    // afterwards there is nothing left that knows the picture is there.
    it('queues the pictures it is about to orphan', async () => {
      rows.set(CustomTrackingFieldEntity, [{ id: 'field-1' }]);
      rows.set(CustomTrackingValueEntity, [{ id: 'value-1' }]);
      rows.set(CustomTrackingImageValueEntity, [
        { cloudflareImageId: 'image-1' },
      ]);

      const summary = await service.purgeExpired(threshold);

      expect(enqueue).toHaveBeenCalledWith(
        manager,
        ['image-1'],
        CustomTrackingImageCleanupReason.RETENTION,
      );
      expect(summary.images).toBe(1);
    });

    it('reports nothing removed when a delete matched nothing', async () => {
      remove.mockResolvedValue({ affected: null });
      rows.set(CustomTrackingSectionEntity, [{ id: 'section-1' }]);

      await expect(service.purgeExpired(threshold)).resolves.toEqual(
        expect.objectContaining({ sections: 0 }),
      );
    });

    // PostgreSQL takes a bounded number of parameters, and a purge after a
    // mass deletion is exactly the occasion that would exceed it.
    it('splits a very large sweep across several statements', async () => {
      const many = Array.from({ length: 501 }, (_, index) => ({
        id: `section-${index}`,
      }));

      rows.set(CustomTrackingSectionEntity, many);

      await service.purgeExpired(threshold);

      expect(
        remove.mock.calls.filter(
          call => call[0] === CustomTrackingSectionEntity,
        ),
      ).toHaveLength(2);
    });
  });

  describe('purgeUsers', () => {
    it('takes everything a closed account had', async () => {
      rows.set(CustomTrackingSectionEntity, [{ id: 'section-1' }]);
      rows.set(CustomTrackingTabEntity, [{ id: 'tab-1' }]);
      rows.set(CustomTrackingFieldEntity, [{ id: 'field-1' }]);
      rows.set(CustomTrackingOptionEntity, [{ id: 'option-1' }]);
      rows.set(CustomTrackingValueEntity, [{ id: 'value-1' }]);

      const summary = await service.purgeUsers(['user-1']);

      expect(summary.sections).toBe(1);
      expect(summary.options).toBe(1);
      expect(deletionOrder()).toContain(
        CustomTrackingPolicyAcceptanceEntity.name,
      );
    });

    // Retention protects an answer's ability to render itself, and there is no
    // longer anybody to render it for.
    it('retains nothing', async () => {
      rows.set(CustomTrackingOptionEntity, [{ id: 'option-1' }]);
      rows.set(CustomTrackingValueOptionEntity, [
        { optionId: 'option-1', valueId: 'value-elsewhere' },
      ]);

      await expect(service.purgeUsers(['user-1'])).resolves.toEqual(
        expect.objectContaining({ retained: 0 }),
      );
    });

    it('queues their pictures against the closure', async () => {
      rows.set(CustomTrackingFieldEntity, [{ id: 'field-1' }]);
      rows.set(CustomTrackingValueEntity, [{ id: 'value-1' }]);
      rows.set(CustomTrackingImageValueEntity, [
        { cloudflareImageId: 'image-1' },
      ]);

      await service.purgeUsers(['user-1']);

      expect(enqueue).toHaveBeenCalledWith(
        manager,
        ['image-1'],
        CustomTrackingImageCleanupReason.ACCOUNT_CLOSED,
      );
    });

    it('opens no transaction for an empty list', async () => {
      await expect(service.purgeUsers([])).resolves.toEqual({
        sections: 0,
        tabs: 0,
        fields: 0,
        options: 0,
        values: 0,
        images: 0,
        retained: 0,
      });

      expect(find).not.toHaveBeenCalled();
    });
  });
});
