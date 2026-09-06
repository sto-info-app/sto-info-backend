import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingStoredAnswer } from '../values/custom-tracking-value.service';
import { CustomTrackingPublicMapper } from './custom-tracking-public.mapper';
import { CustomTrackingPublicSection } from './custom-tracking-public.service';

describe('CustomTrackingPublicMapper', () => {
  let mapper: CustomTrackingPublicMapper;

  beforeEach(() => {
    mapper = new CustomTrackingPublicMapper();
  });

  const field = (
    overrides: Partial<CustomTrackingFieldEntity> = {},
  ): CustomTrackingFieldEntity =>
    ({
      id: 'field-1',
      tabId: 'tab-1',
      fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
      name: 'Ship name',
      description: 'The ship they fly',
      orderIndex: 1000,
      publiclyVisible: true,
      required: false,
      ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
      publicEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
      emptyPlaceholder: 'Not yet decided',
      configuration: { maxLength: 40 },
      suppressedAt: null,
      suppressedByUserId: null,
      ...overrides,
    }) as CustomTrackingFieldEntity;

  const answer = (
    overrides: Partial<CustomTrackingStoredAnswer> = {},
  ): CustomTrackingStoredAnswer => ({
    fieldId: 'field-1',
    fragment: { text: 'Bellerophon' },
    optionIds: [],
    image: null,
    ...overrides,
  });

  const projection = (
    fields: {
      field: CustomTrackingFieldEntity;
      chosen?: CustomTrackingOptionEntity[];
      answer?: CustomTrackingStoredAnswer | null;
    }[],
  ): CustomTrackingPublicSection => ({
    section: {
      id: 'section-1',
      name: 'Fleet duties',
      description: 'What they owe the fleet',
      publiclyVisible: true,
      suppressedAt: null,
      suppressedByUserId: 'admin-1',
    } as CustomTrackingSectionEntity,
    tabs: [
      {
        tab: {
          id: 'tab-1',
          name: 'Provisioning',
          description: null,
          publiclyVisible: true,
          suppressedAt: null,
        } as CustomTrackingTabEntity,
        fields: fields.map(one => ({
          field: one.field,
          chosen: one.chosen ?? [],
          answer: one.answer ?? null,
        })),
      },
    ],
  });

  it('publishes the section, its tab and its fields', () => {
    const mapped = mapper.toSection(
      projection([{ field: field(), answer: answer() }]),
    );

    expect(mapped).toEqual({
      id: 'section-1',
      name: 'Fleet duties',
      description: 'What they owe the fleet',
      tabs: [
        {
          id: 'tab-1',
          name: 'Provisioning',
          description: null,
          fields: [
            {
              id: 'field-1',
              fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
              name: 'Ship name',
              description: 'The ship they fly',
              configuration: { maxLength: 40 },
              emptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
              emptyPlaceholder: 'Not yet decided',
              value: { text: 'Bellerophon' },
              chosen: [],
              image: null,
            },
          ],
        },
      ],
    });
  });

  // Written out property by property, so that adding one to the entity does
  // not publish it. These two are the ones it would hurt most to leak.
  it('keeps the administrator’s suppression and the owner’s empty rule back', () => {
    const mapped = mapper.toSection(projection([{ field: field() }]));
    const published = JSON.stringify(mapped);

    expect(published).not.toContain('suppressed');
    expect(published).not.toContain('ownerEmptyMode');
    expect(published).not.toContain('SHOW_LABEL');
  });

  it('publishes the public empty rule, not the owner’s', () => {
    const mapped = mapper.toSection(
      projection([
        {
          field: field({
            ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
            publicEmptyMode: CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
          }),
        },
      ]),
    );

    expect(mapped.tabs[0].fields[0].emptyMode).toBe(
      CustomTrackingEmptyMode.SHOW_PLACEHOLDER,
    );
  });

  it('publishes no value where nothing was answered', () => {
    const mapped = mapper.toSection(projection([{ field: field() }]));

    expect(mapped.tabs[0].fields[0].value).toBeNull();
    expect(mapped.tabs[0].fields[0].image).toBeNull();
  });

  // Only the labels chosen. The rest of the list is the owner's working
  // vocabulary, and a visitor has no business reading what they rejected.
  it('publishes only the chosen options, and only their labels', () => {
    const mapped = mapper.toSection(
      projection([
        {
          field: field({ fieldType: CustomTrackingFieldType.MULTI_SELECT }),
          chosen: [
            {
              id: 'option-2',
              fieldId: 'field-1',
              label: 'Cruiser',
              orderIndex: 2000,
              isDefault: true,
              deletedAt: null,
            } as CustomTrackingOptionEntity,
          ],
          answer: answer({ fragment: null, optionIds: ['option-2'] }),
        },
      ]),
    );

    expect(mapped.tabs[0].fields[0].chosen).toEqual([
      { id: 'option-2', label: 'Cruiser' },
    ]);
  });

  it('publishes the picture answering an image field', () => {
    const mapped = mapper.toSection(
      projection([
        {
          field: field({ fieldType: CustomTrackingFieldType.IMAGE }),
          answer: answer({
            fragment: null,
            image: {
              cloudflareImageId: 'image-1',
              altText: 'A ship at speed',
              shape: CustomTrackingImageShape.SQUARE,
              entityTag: 'W/"abc"',
            } as unknown as CustomTrackingImageValueEntity,
          }),
        },
      ]),
    );

    expect(mapped.tabs[0].fields[0].image).toEqual({
      imageId: 'image-1',
      altText: 'A ship at speed',
      shape: CustomTrackingImageShape.SQUARE,
    });
  });

  // The Cloudflare identifier is the one thing here that is useful on its own,
  // so a picture left behind on a field that is no longer an image field is
  // treated as the inconsistency it is rather than as something to render.
  it('withholds a picture hanging off a field that is not an image field', () => {
    const mapped = mapper.toSection(
      projection([
        {
          field: field(),
          answer: answer({
            image: {
              cloudflareImageId: 'image-1',
              altText: 'A ship at speed',
              shape: CustomTrackingImageShape.SQUARE,
            } as unknown as CustomTrackingImageValueEntity,
          }),
        },
      ]),
    );

    expect(mapped.tabs[0].fields[0].image).toBeNull();
  });
});
