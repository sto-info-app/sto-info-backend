import { CustomTrackingSectionNode } from '../definitions/custom-tracking-definition-tree.service';
import { CustomTrackingDefinitionMapper } from '../definitions/custom-tracking-definition.mapper';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingRecordMapper } from './custom-tracking-record.mapper';
import { CustomTrackingTarget } from './custom-tracking-target.service';
import { CustomTrackingRecord } from './custom-tracking-value.service';

describe('CustomTrackingRecordMapper', () => {
  let mapper: CustomTrackingRecordMapper;

  beforeEach(() => {
    mapper = new CustomTrackingRecordMapper(
      new CustomTrackingDefinitionMapper(),
    );
  });

  const target: CustomTrackingTarget = {
    scope: CustomTrackingTargetScope.ACCOUNT,
    id: 'account-1',
    label: 'ares',
    publiclyVisible: true,
  };

  const sections = (): CustomTrackingSectionNode[] => [
    {
      section: {
        id: 'section-1',
        targetScope: CustomTrackingTargetScope.ACCOUNT,
        name: 'Ships',
        description: null,
        orderIndex: 1000,
        publiclyVisible: false,
        suppressedAt: new Date('2026-09-04T12:00:00Z'),
        suppressedByUserId: 'moderator-1',
      } as never,
      tabs: [
        {
          tab: {
            id: 'tab-1',
            sectionId: 'section-1',
            name: 'Escorts',
            description: null,
            orderIndex: 1000,
            publiclyVisible: false,
            suppressedAt: null,
          } as never,
          fields: [
            {
              field: {
                id: 'field-1',
                tabId: 'tab-1',
                userId: 'user-1',
                targetScope: CustomTrackingTargetScope.ACCOUNT,
                fieldType: CustomTrackingFieldType.DROPDOWN,
                name: 'Ship class',
                description: null,
                orderIndex: 1000,
                publiclyVisible: false,
                required: false,
                ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
                publicEmptyMode: CustomTrackingEmptyMode.HIDE,
                emptyPlaceholder: null,
                configuration: {},
                suppressedAt: null,
              } as never,
              options: [
                {
                  id: 'option-1',
                  fieldId: 'field-1',
                  label: 'Escort',
                  orderIndex: 1000,
                  isDefault: false,
                  deletedAt: null,
                } as never,
              ],
            },
          ],
        },
      ],
    },
  ];

  const record = (
    overrides: Partial<CustomTrackingRecord> = {},
  ): CustomTrackingRecord => ({
    target,
    sections: sections(),
    answers: [],
    ...overrides,
  });

  it('maps the record being described', () => {
    expect(mapper.toRecord(record()).target).toEqual({
      scope: CustomTrackingTargetScope.ACCOUNT,
      id: 'account-1',
      label: 'ares',
      publiclyVisible: true,
    });
  });

  it('nests tabs and fields inside their section', () => {
    const mapped = mapper.toRecord(record());

    expect(mapped.sections).toHaveLength(1);
    expect(mapped.sections[0].tabs[0].fields[0].name).toBe('Ship class');
    expect(mapped.sections[0].tabs[0].fields[0].options[0].label).toBe(
      'Escort',
    );
  });

  // The definitions go through the same mapper the builder uses, so anything
  // withheld there is withheld here rather than leaking through a second route
  // to the same data.
  it('withholds what the definition mapper withholds', () => {
    const mapped = mapper.toRecord(record());
    const serialised = JSON.stringify(mapped);

    expect(mapped.sections[0].suppressed).toBe(true);
    expect(serialised).not.toContain('moderator-1');
    expect(serialised).not.toContain('suppressedAt');
    expect(serialised).not.toContain('userId');
  });

  it('maps an answer with its selections', () => {
    const mapped = mapper.toRecord(
      record({
        answers: [
          {
            fieldId: 'field-1',
            fragment: { text: 'USS Ares' },
            optionIds: ['option-1'],
            image: null,
          },
        ],
      }),
    );

    expect(mapped.answers).toEqual([
      {
        fieldId: 'field-1',
        value: { text: 'USS Ares' },
        optionIds: ['option-1'],
        image: null,
      },
    ]);
  });

  it('maps a picture answer', () => {
    const mapped = mapper.toRecord(
      record({
        answers: [
          {
            fieldId: 'field-1',
            fragment: null,
            optionIds: [],
            image: {
              cloudflareImageId: 'image-1',
              altText: 'The USS Ares at warp',
              shape: CustomTrackingImageShape.LANDSCAPE,
            } as CustomTrackingImageValueEntity,
          },
        ],
      }),
    );

    expect(mapped.answers[0].image).toEqual({
      imageId: 'image-1',
      altText: 'The USS Ares at warp',
      shape: CustomTrackingImageShape.LANDSCAPE,
    });
  });

  it('reports an answer with nothing stored as such', () => {
    const mapped = mapper.toRecord(
      record({
        answers: [
          { fieldId: 'field-1', fragment: null, optionIds: [], image: null },
        ],
      }),
    );

    expect(mapped.answers[0]).toEqual({
      fieldId: 'field-1',
      value: null,
      optionIds: [],
      image: null,
    });
  });

  // The stored array is the service's; handing it out would let a caller
  // mutate what the service still holds.
  it('copies the selections rather than handing out the stored array', () => {
    const answers = [
      {
        fieldId: 'field-1',
        fragment: null,
        optionIds: ['option-1'],
        image: null,
      },
    ];
    const mapped = mapper.toRecord(record({ answers }));

    mapped.answers[0].optionIds.push('injected');

    expect(answers[0].optionIds).toEqual(['option-1']);
  });
});
