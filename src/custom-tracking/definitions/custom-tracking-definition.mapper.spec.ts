import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingOptionEntity } from '../entities/custom-tracking-option.entity';
import { CustomTrackingSectionEntity } from '../entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from '../entities/custom-tracking-tab.entity';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingDefinitionMapper } from './custom-tracking-definition.mapper';

describe('CustomTrackingDefinitionMapper', () => {
  let mapper: CustomTrackingDefinitionMapper;

  beforeEach(() => {
    mapper = new CustomTrackingDefinitionMapper();
  });

  const section = (
    overrides: Partial<CustomTrackingSectionEntity> = {},
  ): CustomTrackingSectionEntity =>
    ({
      id: 'section-1',
      targetScope: CustomTrackingTargetScope.ACCOUNT,
      name: 'Ship collection',
      description: 'What I have unlocked',
      orderIndex: 1000,
      publiclyVisible: false,
      suppressedAt: null,
      suppressedByUserId: null,
      ...overrides,
    }) as CustomTrackingSectionEntity;

  const option = (
    overrides: Partial<CustomTrackingOptionEntity> = {},
  ): CustomTrackingOptionEntity =>
    ({
      id: 'option-1',
      fieldId: 'field-1',
      label: 'Fleet ship',
      orderIndex: 1000,
      isDefault: false,
      deletedAt: null,
      ...overrides,
    }) as CustomTrackingOptionEntity;

  describe('toSection', () => {
    it('maps what its owner is shown', () => {
      expect(mapper.toSection(section())).toEqual({
        id: 'section-1',
        targetScope: CustomTrackingTargetScope.ACCOUNT,
        name: 'Ship collection',
        description: 'What I have unlocked',
        orderIndex: 1000,
        publiclyVisible: false,
        suppressed: false,
      });
    });

    // Suppression is reported as a fact, not as who did it and when. Neither
    // is any of the user's business, and both would be handing an enforcement
    // record to the person it was made about.
    it('reports suppression without saying who or when', () => {
      const mapped = mapper.toSection(
        section({
          suppressedAt: new Date('2026-09-04T12:00:00Z'),
          suppressedByUserId: 'moderator-1',
        }),
      );

      expect(mapped.suppressed).toBe(true);
      expect(JSON.stringify(mapped)).not.toContain('moderator-1');
      expect(JSON.stringify(mapped)).not.toContain('2026-09-04');
    });
  });

  describe('toTab', () => {
    it('maps what its owner is shown', () => {
      const tab = {
        id: 'tab-1',
        sectionId: 'section-1',
        name: 'Escorts',
        description: null,
        orderIndex: 2000,
        publiclyVisible: true,
        suppressedAt: null,
      } as CustomTrackingTabEntity;

      expect(mapper.toTab(tab)).toEqual({
        id: 'tab-1',
        sectionId: 'section-1',
        name: 'Escorts',
        description: null,
        orderIndex: 2000,
        publiclyVisible: true,
        suppressed: false,
      });
    });

    it('reports a suppressed Tab as suppressed', () => {
      const tab = {
        id: 'tab-1',
        sectionId: 'section-1',
        name: 'Escorts',
        description: null,
        orderIndex: 2000,
        publiclyVisible: true,
        suppressedAt: new Date(),
      } as CustomTrackingTabEntity;

      expect(mapper.toTab(tab).suppressed).toBe(true);
    });
  });

  describe('toField', () => {
    const field = (
      overrides: Partial<CustomTrackingFieldEntity> = {},
    ): CustomTrackingFieldEntity =>
      ({
        id: 'field-1',
        tabId: 'tab-1',
        userId: 'user-1',
        targetScope: CustomTrackingTargetScope.ACCOUNT,
        fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
        name: 'Ship name',
        description: null,
        orderIndex: 1000,
        publiclyVisible: false,
        required: true,
        ownerEmptyMode: CustomTrackingEmptyMode.SHOW_LABEL,
        publicEmptyMode: CustomTrackingEmptyMode.HIDE,
        emptyPlaceholder: null,
        configuration: { maxLength: 40 },
        suppressedAt: null,
        ...overrides,
      }) as unknown as CustomTrackingFieldEntity;

    it('maps what its owner is shown', () => {
      expect(mapper.toField(field())).toMatchObject({
        id: 'field-1',
        tabId: 'tab-1',
        fieldType: CustomTrackingFieldType.TEXT_SINGLE_LINE,
        name: 'Ship name',
        required: true,
        configuration: { maxLength: 40 },
        suppressed: false,
        options: [],
      });
    });

    // The owner's identifier and the scope are on the row for the sake of
    // ownership checks and per-scope limits, not for anybody to read back.
    it('leaves the denormalised owner and scope out of the response', () => {
      const mapped = mapper.toField(field()) as unknown as Record<
        string,
        unknown
      >;

      expect(mapped.userId).toBeUndefined();
      expect(mapped.targetScope).toBeUndefined();
    });

    it('includes the options a choice Field offers', () => {
      const mapped = mapper.toField(
        field({ fieldType: CustomTrackingFieldType.DROPDOWN }),
        [option(), option({ id: 'option-2', label: 'Event ship' })],
      );

      expect(mapped.options).toHaveLength(2);
      expect(mapped.options[1].label).toBe('Event ship');
    });

    it('reports a suppressed Field as suppressed', () => {
      expect(
        mapper.toField(field({ suppressedAt: new Date() })).suppressed,
      ).toBe(true);
    });
  });

  describe('toOption', () => {
    it('maps what its owner is shown', () => {
      expect(mapper.toOption(option())).toEqual({
        id: 'option-1',
        fieldId: 'field-1',
        label: 'Fleet ship',
        orderIndex: 1000,
        isDefault: false,
        withdrawn: false,
      });
    });

    // A value that already chose a withdrawn option has to go on reading
    // correctly, and the editor offering to replace it has to be able to say
    // what it was.
    it('maps a withdrawn option, marked as withdrawn', () => {
      const mapped = mapper.toOption(option({ deletedAt: new Date() }));

      expect(mapped.withdrawn).toBe(true);
      expect(mapped.label).toBe('Fleet ship');
    });

    // The deletion timestamp is what the retention job counts from; it is not
    // something the interface needs, so it is reported as a plain boolean.
    it('does not expose when the option was withdrawn', () => {
      const mapped = mapper.toOption(
        option({ deletedAt: new Date('2026-09-04T12:00:00Z') }),
      ) as unknown as Record<string, unknown>;

      expect(mapped.deletedAt).toBeUndefined();
    });
  });
});
