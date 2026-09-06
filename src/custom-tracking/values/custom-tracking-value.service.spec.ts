import { BadRequestException, NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { YouTubeUrlService } from 'src/storytime/content/youtube-url.service';

import {
  CustomTrackingDefinitionTreeService,
  CustomTrackingSectionNode,
} from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueOptionEntity } from '../entities/custom-tracking-value-option.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';
import { createRepositoryDouble } from '../testing/custom-tracking-test.doubles';
import {
  CustomTrackingTarget,
  CustomTrackingTargetService,
} from './custom-tracking-target.service';
import { CustomTrackingValueValidationService } from './custom-tracking-value-validation.service';
import { CustomTrackingValueService } from './custom-tracking-value.service';

describe('CustomTrackingValueService', () => {
  const userId = 'user-1';
  const scope = CustomTrackingTargetScope.ACCOUNT;

  const target: CustomTrackingTarget = {
    scope,
    id: 'account-1',
    label: 'ares',
    publiclyVisible: true,
  };

  let service: CustomTrackingValueService;
  let valueRefused: jest.Mock<(...args: unknown[]) => void>;
  let values: ReturnType<
    typeof createRepositoryDouble<CustomTrackingValueEntity>
  >;
  let selections: ReturnType<
    typeof createRepositoryDouble<CustomTrackingValueOptionEntity>
  >;
  let images: ReturnType<
    typeof createRepositoryDouble<CustomTrackingImageValueEntity>
  >;
  let findOwned: jest.Mock<() => Promise<CustomTrackingTarget>>;
  let loadTree: jest.Mock<() => Promise<CustomTrackingSectionNode[]>>;
  let manager: {
    findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    create: jest.Mock<(entity: unknown, input: unknown) => unknown>;
    save: jest.Mock<(entity: unknown, row: unknown) => Promise<unknown>>;
    delete: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };

  const field = (
    overrides: Partial<CustomTrackingFieldEntity> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      name: 'Ship name',
      fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
      required: false,
      configuration: { minLength: null, maxLength: null, pattern: null },
      ...overrides,
    }) as unknown as CustomTrackingFieldEntity;

  /** A one-section, one-tab hierarchy holding the given fields. */
  const treeOf = (
    ...fields: CustomTrackingFieldEntity[]
  ): CustomTrackingSectionNode[] => [
    {
      section: { id: 'section-1' } as never,
      tabs: [
        {
          tab: { id: 'tab-1' } as never,
          fields: fields.map(entity => ({ field: entity, options: [] })),
        },
      ],
    },
  ];

  beforeEach(() => {
    values = createRepositoryDouble<CustomTrackingValueEntity>();
    selections = createRepositoryDouble<CustomTrackingValueOptionEntity>();
    images = createRepositoryDouble<CustomTrackingImageValueEntity>();

    findOwned = jest
      .fn<() => Promise<CustomTrackingTarget>>()
      .mockResolvedValue(target);
    loadTree = jest
      .fn<() => Promise<CustomTrackingSectionNode[]>>()
      .mockResolvedValue(treeOf(field()));

    manager = {
      findOne: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(null),
      create: jest.fn((_entity: unknown, input: unknown) => ({
        ...(input as object),
      })),
      save: jest.fn((_entity: unknown, row: unknown) =>
        Promise.resolve(
          Array.isArray(row) ? row : { id: 'value-1', ...(row as object) },
        ),
      ),
      delete: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    };

    valueRefused = jest.fn();
    service = new CustomTrackingValueService(
      values.repository,
      selections.repository,
      images.repository,
      {
        findOwned,
        whereFor: (t: CustomTrackingTarget) =>
          t.scope === CustomTrackingTargetScope.ACCOUNT
            ? { accountId: t.id }
            : { characterId: t.id },
      } as unknown as CustomTrackingTargetService,
      { load: loadTree } as unknown as CustomTrackingDefinitionTreeService,
      new CustomTrackingValueValidationService(new YouTubeUrlService()),
      { valueRefused } as unknown as CustomTrackingObservabilityService,
      {
        transaction: (body: (m: unknown) => Promise<unknown>) => body(manager),
      } as unknown as DataSource,
    );
  });

  describe('loadRecord', () => {
    it('returns the record with nothing answered yet', async () => {
      await expect(
        service.loadRecord(userId, scope, 'account-1'),
      ).resolves.toEqual({
        target,
        sections: treeOf(field()),
        answers: [],
      });
    });

    it('returns what has been answered, with its selections and picture', async () => {
      values.double.find.mockResolvedValue([
        {
          id: 'value-1',
          fieldId: 'field-1',
          value: { text: 'USS Ares' },
        } as CustomTrackingValueEntity,
      ]);
      selections.double.find.mockResolvedValue([
        { valueId: 'value-1', optionId: 'option-1' },
        { valueId: 'value-2', optionId: 'option-9' },
      ] as CustomTrackingValueOptionEntity[]);
      images.double.find.mockResolvedValue([
        { valueId: 'value-1', cloudflareImageId: 'image-1' },
      ] as CustomTrackingImageValueEntity[]);

      const record = await service.loadRecord(userId, scope, 'account-1');

      expect(record.answers).toEqual([
        {
          fieldId: 'field-1',
          fragment: { text: 'USS Ares' },
          optionIds: ['option-1'],
          image: expect.objectContaining({ cloudflareImageId: 'image-1' }),
        },
      ]);
    });

    it('reports no picture where there is none', async () => {
      values.double.find.mockResolvedValue([
        { id: 'value-1', fieldId: 'field-1', value: null },
      ] as CustomTrackingValueEntity[]);

      const record = await service.loadRecord(userId, scope, 'account-1');

      expect(record.answers[0].image).toBeNull();
    });

    it('refuses a record that is not the caller’s', async () => {
      findOwned.mockRejectedValue(new NotFoundException());

      await expect(
        service.loadRecord(userId, scope, 'account-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('saveRecord', () => {
    const save = (answers: { fieldId: string; value: unknown }[]) =>
      service.saveRecord(userId, scope, 'account-1', answers);

    it('writes a new answer against the right target', async () => {
      await save([{ fieldId: 'field-1', value: { text: 'USS Ares' } }]);

      expect(manager.create).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.objectContaining({
          fieldId: 'field-1',
          targetScope: scope,
          accountId: 'account-1',
          characterId: null,
        }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.objectContaining({ value: { text: 'USS Ares' } }),
      );
    });

    it('records a character answer against the character, not an account', async () => {
      findOwned.mockResolvedValue({
        scope: CustomTrackingTargetScope.CHARACTER,
        id: 'character-1',
        label: 'Kira@ares',
        publiclyVisible: false,
      });

      await service.saveRecord(
        userId,
        CustomTrackingTargetScope.CHARACTER,
        'character-1',
        [{ fieldId: 'field-1', value: { text: 'USS Ares' } }],
      );

      expect(manager.create).toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.objectContaining({
          accountId: null,
          characterId: 'character-1',
        }),
      );
    });

    it('updates the row already there rather than adding another', async () => {
      const existing = {
        id: 'value-1',
        fieldId: 'field-1',
        value: { text: 'Old' },
      } as CustomTrackingValueEntity;

      manager.findOne.mockResolvedValue(existing);

      await save([{ fieldId: 'field-1', value: { text: 'New' } }]);

      expect(manager.create).not.toHaveBeenCalledWith(
        CustomTrackingValueEntity,
        expect.anything(),
      );
      expect(existing.value).toEqual({ text: 'New' });
    });

    // A cleared answer is not a deletion anybody needs to recover, and keeping
    // the row would leave the unique index believing the field is answered.
    it('removes the row when an answer is cleared', async () => {
      manager.findOne.mockResolvedValue({
        id: 'value-1',
      } as CustomTrackingValueEntity);

      await save([{ fieldId: 'field-1', value: null }]);

      expect(manager.delete).toHaveBeenCalledWith(CustomTrackingValueEntity, {
        id: 'value-1',
      });
    });

    it('does nothing when clearing an answer that was never given', async () => {
      manager.findOne.mockResolvedValue(null);

      await save([{ fieldId: 'field-1', value: null }]);

      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('treats an empty answer as clearing it', async () => {
      manager.findOne.mockResolvedValue({
        id: 'value-1',
      } as CustomTrackingValueEntity);

      await save([{ fieldId: 'field-1', value: { text: '   ' } }]);

      expect(manager.delete).toHaveBeenCalledWith(CustomTrackingValueEntity, {
        id: 'value-1',
      });
    });

    it('rewrites option selections wholesale', async () => {
      loadTree.mockResolvedValue([
        {
          section: { id: 'section-1' } as never,
          tabs: [
            {
              tab: { id: 'tab-1' } as never,
              fields: [
                {
                  field: field({
                    id: 'field-2',
                    fieldType: CustomTrackingFieldType.MULTI_SELECT,
                    configuration: {
                      minimumSelections: null,
                      maximumSelections: null,
                    } as never,
                  }),
                  options: [
                    { id: 'option-1', label: 'Escort', deletedAt: null },
                    { id: 'option-2', label: 'Cruiser', deletedAt: null },
                  ] as never,
                },
              ],
            },
          ],
        },
      ]);

      await save([
        { fieldId: 'field-2', value: { optionIds: ['option-2', 'option-1'] } },
      ]);

      expect(manager.delete).toHaveBeenCalledWith(
        CustomTrackingValueOptionEntity,
        { valueId: 'value-1' },
      );
      expect(manager.save).toHaveBeenCalledWith(
        CustomTrackingValueOptionEntity,
        [
          expect.objectContaining({ optionId: 'option-2', orderIndex: 0 }),
          expect.objectContaining({ optionId: 'option-1', orderIndex: 1 }),
        ],
      );
    });

    // Ignoring an unknown field would let a save silently discard something
    // the user believed they had entered.
    it('refuses an answer to a field this record does not have', async () => {
      await expect(
        save([{ fieldId: 'somebody-elses-field', value: { text: 'x' } }]),
      ).rejects.toThrow('That record has no such field');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses the same field answered twice in one save', async () => {
      await expect(
        save([
          { fieldId: 'field-1', value: { text: 'One' } },
          { fieldId: 'field-1', value: { text: 'Two' } },
        ]),
      ).rejects.toThrow('answered twice');
    });

    it('refuses an answer the field will not accept', async () => {
      loadTree.mockResolvedValue(
        treeOf(
          field({
            configuration: {
              minLength: 5,
              maxLength: null,
              pattern: null,
            } as never,
          }),
        ),
      );

      await expect(
        save([{ fieldId: 'field-1', value: { text: 'abc' } }]),
      ).rejects.toThrow('at least 5 characters');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses a save leaving a required field unanswered', async () => {
      loadTree.mockResolvedValue(treeOf(field({ required: true })));

      await expect(save([])).rejects.toThrow(
        'These fields still need an answer before this record can be saved: Ship name.',
      );
    });

    // A user clearing a required answer has to be stopped just as surely as
    // one who never gave it.
    it('refuses clearing an answer a required field still needs', async () => {
      loadTree.mockResolvedValue(treeOf(field({ required: true })));
      values.double.find.mockResolvedValue([
        {
          id: 'value-1',
          fieldId: 'field-1',
          value: { text: 'USS Ares' },
        } as CustomTrackingValueEntity,
      ]);

      await expect(save([{ fieldId: 'field-1', value: null }])).rejects.toThrow(
        BadRequestException,
      );
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('allows a save where a required field is already answered', async () => {
      loadTree.mockResolvedValue(
        treeOf(field({ required: true }), field({ id: 'field-2' })),
      );
      values.double.find.mockResolvedValue([
        {
          id: 'value-1',
          fieldId: 'field-1',
          value: { text: 'USS Ares' },
        } as CustomTrackingValueEntity,
      ]);

      await expect(
        save([{ fieldId: 'field-2', value: { text: 'Anything' } }]),
      ).resolves.toBeDefined();
    });

    it('names every required field still missing', async () => {
      loadTree.mockResolvedValue(
        treeOf(
          field({ required: true }),
          field({ id: 'field-2', name: 'Registry', required: true }),
        ),
      );

      await expect(save([])).rejects.toThrow(/Ship name, Registry/);
    });

    it('returns the record as it stands afterwards', async () => {
      const record = await save([
        { fieldId: 'field-1', value: { text: 'USS Ares' } },
      ]);

      expect(record.target).toEqual(target);
      expect(record.sections).toEqual(treeOf(field()));
    });

    it('refuses a record that is not the caller’s', async () => {
      findOwned.mockRejectedValue(new NotFoundException());

      await expect(save([])).rejects.toThrow(NotFoundException);
    });
  });
});
