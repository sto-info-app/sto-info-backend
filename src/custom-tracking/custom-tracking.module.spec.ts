import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { S3Client } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';

import { AppSettingEntity } from '../settings/entities/app-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { ImageUploadsService } from '../shared/utilities/image-uploads.service';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CharacterEntity } from '../sto/character/entities/character.entity';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { CustomTrackingConfigurationController } from './custom-tracking-configuration.controller';
import { CustomTrackingEditingGuard } from './custom-tracking-editing.guard';
import { CustomTrackingFeatureService } from './custom-tracking-feature.service';
import { CustomTrackingModule } from './custom-tracking.module';
import { CustomTrackingCascadeService } from './definitions/custom-tracking-cascade.service';
import { CustomTrackingDefinitionSupportService } from './definitions/custom-tracking-definition-support.service';
import { CustomTrackingDefinitionTreeService } from './definitions/custom-tracking-definition-tree.service';
import { CustomTrackingDefinitionMapper } from './definitions/custom-tracking-definition.mapper';
import { CustomTrackingFieldConfigurationService } from './definitions/custom-tracking-field-configuration.service';
import { CustomTrackingFieldService } from './definitions/custom-tracking-field.service';
import { CustomTrackingFieldsController } from './definitions/custom-tracking-fields.controller';
import { CustomTrackingOptionService } from './definitions/custom-tracking-option.service';
import { CustomTrackingOptionsController } from './definitions/custom-tracking-options.controller';
import { CustomTrackingSectionService } from './definitions/custom-tracking-section.service';
import { CustomTrackingSectionsController } from './definitions/custom-tracking-sections.controller';
import { CustomTrackingTabService } from './definitions/custom-tracking-tab.service';
import { CustomTrackingTabsController } from './definitions/custom-tracking-tabs.controller';
import { CustomTrackingFieldEntity } from './entities/custom-tracking-field.entity';
import { CustomTrackingImageCleanupEntity } from './entities/custom-tracking-image-cleanup.entity';
import { CustomTrackingImageValueEntity } from './entities/custom-tracking-image-value.entity';
import { CustomTrackingOptionEntity } from './entities/custom-tracking-option.entity';
import { CustomTrackingPolicyAcceptanceEntity } from './entities/custom-tracking-policy-acceptance.entity';
import { CustomTrackingSectionEntity } from './entities/custom-tracking-section.entity';
import { CustomTrackingTabEntity } from './entities/custom-tracking-tab.entity';
import { CustomTrackingValueOptionEntity } from './entities/custom-tracking-value-option.entity';
import { CustomTrackingValueEntity } from './entities/custom-tracking-value.entity';
import { CustomTrackingImageService } from './images/custom-tracking-image.service';
import { CustomTrackingImagesController } from './images/custom-tracking-images.controller';
import { CustomTrackingModerationController } from './moderation/custom-tracking-moderation.controller';
import { CustomTrackingModerationService } from './moderation/custom-tracking-moderation.service';
import { CustomTrackingObservabilityService } from './observability/custom-tracking-observability.service';
import { CustomTrackingPolicyController } from './policy/custom-tracking-policy.controller';
import { CustomTrackingPolicyService } from './policy/custom-tracking-policy.service';
import { CustomTrackingPublicMapper } from './public/custom-tracking-public.mapper';
import { CustomTrackingPublicService } from './public/custom-tracking-public.service';
import { CustomTrackingImageCleanupService } from './retention/custom-tracking-image-cleanup.service';
import { CustomTrackingPurgeService } from './retention/custom-tracking-purge.service';
import { CustomTrackingRecordMapper } from './values/custom-tracking-record.mapper';
import { CustomTrackingTargetService } from './values/custom-tracking-target.service';
import { CustomTrackingValueEditingGuard } from './values/custom-tracking-value-editing.guard';
import { CustomTrackingValueValidationService } from './values/custom-tracking-value-validation.service';
import { CustomTrackingValueService } from './values/custom-tracking-value.service';
import { CustomTrackingValuesController } from './values/custom-tracking-values.controller';

/**
 * Compiled for real rather than inspected as metadata.
 *
 * A metadata check says the providers are listed; only compiling says they can
 * actually be constructed. The four definition services depend on one another
 * in a chain and on a shared support service, and a missing provider or a
 * cycle introduced later would show up here and nowhere else until the
 * application refused to start.
 */
/**
 * Stands in for what TypeOrmModule makes available application-wide.
 *
 * The real `DataSource` is published by TypeORM's own global module, which is
 * why neither this feature nor any other imports it. Reproducing that shape —
 * global, and exporting the same token — is what lets the module graph compile
 * here exactly as it does in the application, rather than compiling because
 * the test rearranged it.
 */
@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: { manager: {}, transaction: jest.fn() },
    },
  ],
  exports: [DataSource],
})
class StubDataSourceModule {}

describe('CustomTrackingModule', () => {
  // AppSettingEntity is here because importing SettingsModule brings its own
  // repository with it. Overriding that repository is what lets the module
  // graph compile without a live database behind it.
  const entities = [
    AppSettingEntity,
    CustomTrackingPolicyAcceptanceEntity,
    CustomTrackingSectionEntity,
    CustomTrackingTabEntity,
    CustomTrackingFieldEntity,
    CustomTrackingOptionEntity,
    CustomTrackingValueEntity,
    CustomTrackingValueOptionEntity,
    CustomTrackingImageValueEntity,
    CustomTrackingImageCleanupEntity,
    AccountEntity,
    CharacterEntity,
    UserProfileEntity,
  ];

  const compile = async () => {
    const builder = Test.createTestingModule({
      // ConfigModule is registered globally by the application, which is why
      // neither this module nor Storytime's imports it. A testing module has
      // no such global, so it is supplied here.
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        StubDataSourceModule,
        CustomTrackingModule,
      ],
    })
      .overrideProvider(SettingsService)
      .useValue({ getBoolean: jest.fn() })
      .overrideProvider(ImageUploadsService)
      .useValue({})
      .overrideProvider(S3Client)
      .useValue({})
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn() });

    for (const entity of entities) {
      builder.overrideProvider(getRepositoryToken(entity)).useValue({});
    }

    return builder.compile();
  };

  it.each([
    ['the feature switches', CustomTrackingFeatureService],
    ['the content agreement', CustomTrackingPolicyService],
    ['the editing guard', CustomTrackingEditingGuard],
    ['the shared hierarchy rules', CustomTrackingDefinitionSupportService],
    ['deletion cascades', CustomTrackingCascadeService],
    ['the owner mapper', CustomTrackingDefinitionMapper],
    ['field configuration checks', CustomTrackingFieldConfigurationService],
    ['sections', CustomTrackingSectionService],
    ['tabs', CustomTrackingTabService],
    ['fields', CustomTrackingFieldService],
    ['options', CustomTrackingOptionService],
    ['the definition tree loader', CustomTrackingDefinitionTreeService],
    ['answer validation', CustomTrackingValueValidationService],
    ['the record targets', CustomTrackingTargetService],
    ['recorded values', CustomTrackingValueService],
    ['the record mapper', CustomTrackingRecordMapper],
    ['the value editing guard', CustomTrackingValueEditingGuard],
    ['pictures', CustomTrackingImageService],
    ['the public projection', CustomTrackingPublicService],
    ['the public mapper', CustomTrackingPublicMapper],
    ['the record of what went wrong', CustomTrackingObservabilityService],
    ['the picture deletion queue', CustomTrackingImageCleanupService],
    ['the retention purge', CustomTrackingPurgeService],
    ['administrative suppression', CustomTrackingModerationService],
  ])('can construct %s', async (_description, provider) => {
    const moduleRef = await compile();

    expect(moduleRef.get(provider)).toBeDefined();

    await moduleRef.close();
  });

  it.each([
    ['configuration', CustomTrackingConfigurationController],
    ['the agreement', CustomTrackingPolicyController],
    ['sections', CustomTrackingSectionsController],
    ['tabs', CustomTrackingTabsController],
    ['fields', CustomTrackingFieldsController],
    ['options', CustomTrackingOptionsController],
    ['values', CustomTrackingValuesController],
    ['pictures', CustomTrackingImagesController],
    ['moderation', CustomTrackingModerationController],
  ])('can construct the %s controller', async (_description, controller) => {
    const moduleRef = await compile();

    expect(moduleRef.get(controller)).toBeDefined();

    await moduleRef.close();
  });

  // Exported so the values, images and public projection areas built on top of
  // this one can reach the definitions without importing their repositories.
  it('exports what the rest of the feature will need', () => {
    const exported = Reflect.getMetadata('exports', CustomTrackingModule) as
      | unknown[]
      | undefined;

    expect(exported).toEqual(
      expect.arrayContaining([
        CustomTrackingFeatureService,
        CustomTrackingPolicyService,
        CustomTrackingSectionService,
        CustomTrackingTabService,
        CustomTrackingFieldService,
        CustomTrackingOptionService,
        CustomTrackingDefinitionTreeService,
        CustomTrackingValueService,
        CustomTrackingTargetService,
        CustomTrackingImageService,
        CustomTrackingPublicService,
        CustomTrackingPublicMapper,
        CustomTrackingObservabilityService,
        CustomTrackingImageCleanupService,
        CustomTrackingPurgeService,
      ]),
    );
  });
});
