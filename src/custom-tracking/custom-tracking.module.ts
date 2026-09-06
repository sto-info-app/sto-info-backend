import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsModule } from '../settings/settings.module';
import { SharedModule } from '../shared/shared.module';
import { AccountEntity } from '../sto/account/entities/account.entity';
import { CharacterEntity } from '../sto/character/entities/character.entity';
import { YouTubeUrlService } from '../storytime/content/youtube-url.service';
import { StorytimeOrderingService } from '../storytime/shared/storytime-ordering.service';
import { UserProfileEntity } from '../user/entities/user-profile.entity';
import { CustomTrackingConfigurationController } from './custom-tracking-configuration.controller';
import { CustomTrackingEditingGuard } from './custom-tracking-editing.guard';
import { CustomTrackingFeatureService } from './custom-tracking-feature.service';
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
 * Custom Tracking — a user's own sections, tabs, fields and values for their
 * STO Accounts and Characters.
 *
 * A module of its own rather than an extension of the generic application
 * settings. This is a domain with its own hierarchy, its own limits, its own
 * agreement and its own retention, and folding it into a settings row would
 * have made every one of those a matter of convention rather than of schema.
 *
 * `StorytimeOrderingService` is provided here rather than imported from
 * Storytime's module. It is stateless arithmetic with no dependencies, so a
 * second instance costs nothing, and taking it this way avoids pulling the
 * whole Stories module — repositories, mappers and all — into a feature that
 * needs none of it. Copying the arithmetic instead would have been the worse
 * trade: two implementations of a position calculation that must agree.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
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
    ]),
    SettingsModule,
    SharedModule,
  ],
  controllers: [
    CustomTrackingConfigurationController,
    CustomTrackingPolicyController,
    CustomTrackingSectionsController,
    CustomTrackingTabsController,
    CustomTrackingFieldsController,
    CustomTrackingOptionsController,
    CustomTrackingValuesController,
    CustomTrackingImagesController,
    CustomTrackingModerationController,
  ],
  providers: [
    StorytimeOrderingService,
    CustomTrackingObservabilityService,
    CustomTrackingFeatureService,
    CustomTrackingPolicyService,
    CustomTrackingEditingGuard,
    CustomTrackingDefinitionSupportService,
    CustomTrackingCascadeService,
    CustomTrackingDefinitionMapper,
    CustomTrackingFieldConfigurationService,
    CustomTrackingSectionService,
    CustomTrackingTabService,
    CustomTrackingFieldService,
    CustomTrackingOptionService,
    CustomTrackingDefinitionTreeService,
    YouTubeUrlService,
    CustomTrackingValueValidationService,
    CustomTrackingTargetService,
    CustomTrackingValueService,
    CustomTrackingRecordMapper,
    CustomTrackingValueEditingGuard,
    CustomTrackingImageService,
    CustomTrackingPublicService,
    CustomTrackingPublicMapper,
    CustomTrackingImageCleanupService,
    CustomTrackingPurgeService,
    CustomTrackingModerationService,
  ],
  exports: [
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
  ],
})
export class CustomTrackingModule {}
