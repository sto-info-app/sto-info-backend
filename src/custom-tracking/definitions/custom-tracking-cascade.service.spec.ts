import { In, IsNull } from 'typeorm';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import {
  CustomTrackingFieldPicture,
  CustomTrackingFieldPictureService,
} from '../images/custom-tracking-field-picture.service';
import { createEntityManagerDouble } from '../testing/custom-tracking-test.doubles';
import { CustomTrackingCascadeService } from './custom-tracking-cascade.service';

describe('CustomTrackingCascadeService', () => {
  const deletedAt = new Date('2026-09-04T12:00:00Z');

  const picture: CustomTrackingFieldPicture = {
    imageValueId: 'image-value-1',
    valueId: 'value-1',
    fieldId: 'field-1',
    targetId: 'account-1',
    imageId: 'image-1',
  };

  let service: CustomTrackingCascadeService;
  let doubles: ReturnType<typeof createEntityManagerDouble>;
  let pictures: { detach: jest.Mock; withdrawEach: jest.Mock };

  beforeEach(() => {
    pictures = {
      detach: jest.fn().mockResolvedValue([]),
      withdrawEach: jest.fn().mockResolvedValue(0),
    };
    service = new CustomTrackingCascadeService(
      pictures as unknown as CustomTrackingFieldPictureService,
    );
    doubles = createEntityManagerDouble();
  });

  /** Answers `find` differently depending on which table is asked. */
  const findReturns = (tabs: string[], fields: string[]): void => {
    doubles.double.find.mockImplementation((entity: unknown) => {
      if (entity === CustomTrackingTabEntity) {
        return Promise.resolve(tabs.map(id => ({ id })));
      }

      if (entity === CustomTrackingFieldEntity) {
        return Promise.resolve(fields.map(id => ({ id })));
      }

      return Promise.resolve([]);
    });
  };

  describe('deleteSection', () => {
    // Descendants are marked in their own right rather than left to be
    // filtered out through a deleted parent. The retention job has to find
    // every row that became unreachable and when.
    it('marks the whole branch, not just the Section', async () => {
      findReturns(['tab-1'], ['field-1']);

      await service.deleteSection(doubles.manager, 'section-1', deletedAt);

      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingOptionEntity,
        { fieldId: In(['field-1']), deletedAt: IsNull() },
        { deletedAt },
      );
      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingFieldEntity,
        { id: In(['field-1']) },
        { deletedAt },
      );
      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingTabEntity,
        { id: In(['tab-1']) },
        { deletedAt },
      );
      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingSectionEntity,
        { id: 'section-1' },
        { deletedAt },
      );
    });

    it('deletes an empty Section without touching anything else', async () => {
      findReturns([], []);

      await service.deleteSection(doubles.manager, 'section-1', deletedAt);

      expect(doubles.double.update).toHaveBeenCalledTimes(1);
      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingSectionEntity,
        { id: 'section-1' },
        { deletedAt },
      );
    });

    it('deletes a Section whose Tabs hold no Fields', async () => {
      findReturns(['tab-1'], []);

      await service.deleteSection(doubles.manager, 'section-1', deletedAt);

      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingTabEntity,
        { id: In(['tab-1']) },
        { deletedAt },
      );
      expect(doubles.double.update).not.toHaveBeenCalledWith(
        CustomTrackingFieldEntity,
        expect.anything(),
        expect.anything(),
      );
    });

    it('records the same moment against every row', async () => {
      findReturns(['tab-1'], ['field-1']);

      await service.deleteSection(doubles.manager, 'section-1', deletedAt);

      for (const call of doubles.double.update.mock.calls) {
        expect(call[2]).toEqual({ deletedAt });
      }
    });
  });

  describe('deleteTabs', () => {
    it('does nothing when there are no Tabs to delete', async () => {
      await expect(
        service.deleteTabs(doubles.manager, [], deletedAt),
      ).resolves.toEqual([]);

      expect(doubles.double.update).not.toHaveBeenCalled();
    });

    it('marks the Fields beneath before the Tabs themselves', async () => {
      findReturns([], ['field-1', 'field-2']);

      await service.deleteTabs(doubles.manager, ['tab-1'], deletedAt);

      const targets = doubles.double.update.mock.calls.map(call => call[0]);

      expect(targets.indexOf(CustomTrackingFieldEntity)).toBeLessThan(
        targets.indexOf(CustomTrackingTabEntity),
      );
    });
  });

  describe('deleteFields', () => {
    it('does nothing when there are no Fields to delete', async () => {
      await expect(
        service.deleteFields(doubles.manager, [], deletedAt),
      ).resolves.toEqual([]);

      expect(doubles.double.update).not.toHaveBeenCalled();
      expect(pictures.detach).not.toHaveBeenCalled();
    });

    // A picture is published, so it is the one thing a deletion does not
    // keep: its answer goes in the same transaction as the Field.
    it("removes the Fields' picture answers in the same transaction", async () => {
      pictures.detach.mockResolvedValue([picture]);

      await expect(
        service.deleteFields(doubles.manager, ['field-1'], deletedAt),
      ).resolves.toEqual([picture]);

      expect(pictures.detach).toHaveBeenCalledWith(doubles.manager, [
        'field-1',
      ]);
    });

    // Only live options are touched. One withdrawn earlier keeps the moment it
    // was actually withdrawn, which is what the retention window counts from.
    it('leaves an already-withdrawn option at its original moment', async () => {
      await service.deleteFields(doubles.manager, ['field-1'], deletedAt);

      expect(doubles.double.update).toHaveBeenCalledWith(
        CustomTrackingOptionEntity,
        { fieldId: In(['field-1']), deletedAt: IsNull() },
        { deletedAt },
      );
    });
  });

  // Deleting a Section reaches every Field beneath it, and so every picture.
  it('passes the pictures up from every level', async () => {
    findReturns(['tab-1'], ['field-1']);
    pictures.detach.mockResolvedValue([picture]);

    await expect(
      service.deleteSection(doubles.manager, 'section-1', deletedAt),
    ).resolves.toEqual([picture]);
  });

  it('withdraws what a committed deletion took with it', async () => {
    await service.withdraw([picture]);

    expect(pictures.withdrawEach).toHaveBeenCalledWith([picture]);
  });

  describe('describeSectionDeletion', () => {
    // The answers are the number that matters. Definitions can be typed again;
    // what somebody recorded against forty characters cannot.
    it('counts the Tabs, Fields and answers that would go', async () => {
      findReturns(['tab-1', 'tab-2'], ['field-1', 'field-2', 'field-3']);
      doubles.double.count.mockResolvedValue(19);

      await expect(
        service.describeSectionDeletion(doubles.manager, 'section-1'),
      ).resolves.toEqual({ tabs: 2, fields: 3, values: 19 });
      expect(doubles.double.count).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        { where: { fieldId: In(['field-1', 'field-2', 'field-3']) } },
      );
    });

    it('counts nothing for an empty Section', async () => {
      findReturns([], []);

      await expect(
        service.describeSectionDeletion(doubles.manager, 'section-1'),
      ).resolves.toEqual({ tabs: 0, fields: 0, values: 0 });
    });

    // Counting nothing is not the same as asking the database to count
    // nothing, and `In([])` is a query no database should be sent.
    it('asks for no count where there are no Fields', async () => {
      findReturns([], []);

      await service.describeSectionDeletion(doubles.manager, 'section-1');

      expect(doubles.double.count).not.toHaveBeenCalled();
    });

    it('reports what it counted rather than changing anything', async () => {
      findReturns(['tab-1'], ['field-1']);

      await service.describeSectionDeletion(doubles.manager, 'section-1');

      expect(doubles.double.update).not.toHaveBeenCalled();
    });
  });

  describe('describeTabDeletion', () => {
    it('counts the Fields and answers that would go', async () => {
      findReturns([], ['field-1', 'field-2']);
      doubles.double.count.mockResolvedValue(7);

      await expect(
        service.describeTabDeletion(doubles.manager, 'tab-1'),
      ).resolves.toEqual({ tabs: 0, fields: 2, values: 7 });
    });
  });

  describe('describeFieldDeletion', () => {
    // Nothing goes with a Field but the answers recorded against it, and those
    // are exactly what cannot be typed again from memory.
    it('counts the answers that would go', async () => {
      doubles.double.count.mockResolvedValue(3);

      await expect(
        service.describeFieldDeletion(doubles.manager, 'field-1'),
      ).resolves.toEqual({ tabs: 0, fields: 0, values: 3 });
      expect(doubles.double.count).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        { where: { fieldId: In(['field-1']) } },
      );
    });
  });
});
