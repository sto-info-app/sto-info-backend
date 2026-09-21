import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getRepositoryToken } from '@nestjs/typeorm';

import { CommunityModule } from '../community/community.module';
import { FileAssetEntity } from '../file-assets/entities/file-asset.entity';
import { PlatformEntity } from '../sto/platform/entities/platform.entity';
import { UserEntity } from '../user/entities/user.entity';
import { FleetAudienceService } from './authorisation/fleet-audience.service';
import { FleetAuthorisationRevisionService } from './authorisation/fleet-authorisation-revision.service';
import { FleetAuthorisationService } from './authorisation/fleet-authorisation.service';
import { ScopeCapabilityGuard } from './authorisation/scope-capability.guard';
import { CharacterFleetsController } from './character-fleets.controller';
import { CommunityArmadasController } from './community-armadas.controller';
import { CommunityFleetsController } from './community-fleets.controller';
import { ArmadaFleetMembershipEntity } from './entities/armada-fleet-membership.entity';
import { CharacterFleetMembershipEntity } from './entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from './entities/character-fleet-proposal.entity';
import { CommunitySubscriptionEntity } from './entities/community-subscription.entity';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { FleetNameAliasEntity } from './entities/fleet-name-alias.entity';
import { FleetSlugHistoryEntity } from './entities/fleet-slug-history.entity';
import { ScopeCapabilityGrantEntity } from './entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from './entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from './entities/scope-role-assignment.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetCommunitiesController } from './fleet-communities.controller';
import { FleetConfigurationController } from './fleet-configuration.controller';
import { FleetDirectoryController } from './fleet-directory.controller';
import { FleetFeatureService } from './fleet-feature.service';
import { FleetPolicyService } from './fleet-policy.service';
import { FleetScopeResolutionController } from './fleet-scope-resolution.controller';
import { FleetModule } from './fleet.module';
import { FleetCommunityMapper } from './mappers/fleet-community.mapper';
import { StoArmadaMapper } from './mappers/sto-armada.mapper';
import { StoFleetMapper } from './mappers/sto-fleet.mapper';
import { CharacterFleetMembershipService } from './services/character-fleet-membership.service';
import { CharacterFleetProposalService } from './services/character-fleet-proposal.service';
import { FleetCommunityService } from './services/fleet-community.service';
import { FleetPlatformService } from './services/fleet-platform.service';
import { FleetSlugService } from './services/fleet-slug.service';
import { StoArmadaService } from './services/sto-armada.service';
import { StoFleetService } from './services/sto-fleet.service';
import { UnregisteredFleetsController } from './unregistered-fleets.controller';

interface FeatureModule {
  providers?: Array<{ provide?: unknown }>;
}

describe('FleetModule', () => {
  const ENTITIES = [
    FleetCommunityEntity,
    StoFleetEntity,
    StoArmadaEntity,
    FleetNameAliasEntity,
    FleetSlugHistoryEntity,
    ArmadaFleetMembershipEntity,
    CommunitySubscriptionEntity,
    ScopeMembershipEntity,
    ScopeRoleAssignmentEntity,
    ScopeCapabilityGrantEntity,
    CharacterFleetMembershipEntity,
    CharacterFleetProposalEntity,
  ];

  /**
   * Registered for their repositories, but owned by other modules.
   *
   * `forFeature` registrations are per-module even when the module declaring
   * them is global, so borrowing one means registering it again here.
   */
  const BORROWED_ENTITIES = [UserEntity, PlatformEntity, FileAssetEntity];

  const SERVICES = [
    FleetFeatureService,
    FleetPolicyService,
    FleetSlugService,
    FleetPlatformService,
    FleetCommunityService,
    StoFleetService,
    StoArmadaService,
    CharacterFleetMembershipService,
    CharacterFleetProposalService,
    FleetAuthorisationService,
    FleetAudienceService,
    FleetAuthorisationRevisionService,
    ScopeCapabilityGuard,
  ];

  const registeredTokens = (): unknown[] => {
    const imports = Reflect.getMetadata('imports', FleetModule) as
      FeatureModule[] | undefined;

    return (imports ?? []).flatMap(
      imported => imported.providers?.map(provider => provider.provide) ?? [],
    );
  };

  it('registers a repository for every Fleet entity', () => {
    const tokens = registeredTokens();

    for (const entity of [...ENTITIES, ...BORROWED_ENTITIES]) {
      expect(tokens).toContain(getRepositoryToken(entity));
    }
  });

  /**
   * An entity that exists but is never registered fails silently: nothing
   * injects its repository yet, so nothing complains until the ticket that
   * needs it. Comparing the directory against the module turns that into a
   * failing test at the moment the file is added.
   */
  it('leaves no entity file unregistered', () => {
    const files = readdirSync(join(__dirname, 'entities')).filter(name =>
      name.endsWith('.entity.ts'),
    );

    expect(files).toHaveLength(ENTITIES.length);
    expect(registeredTokens()).toHaveLength(
      ENTITIES.length + BORROWED_ENTITIES.length,
    );
  });

  it('provides and exports the feature switch and authorisation policy', () => {
    const providers = Reflect.getMetadata(
      'providers',
      FleetModule,
    ) as unknown[];
    const exported = Reflect.getMetadata('exports', FleetModule) as unknown[];

    for (const service of SERVICES) {
      expect(providers).toContain(service);
      expect(exported).toContain(service);
    }
  });

  /**
   * A scoped capability means nothing outside this feature, and a globally
   * available scope policy is an invitation to reach for it from somewhere that
   * should be asking the site-wide service instead.
   */
  it('exposes the client configuration endpoint', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      FleetModule,
    ) as unknown[];

    expect(controllers).toContain(FleetConfigurationController);
  });

  it('exposes the Community registration endpoints', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      FleetModule,
    ) as unknown[];

    expect(controllers).toContain(FleetCommunitiesController);
  });

  it.each([
    CommunityFleetsController,
    CommunityArmadasController,
    UnregisteredFleetsController,
    CharacterFleetsController,
  ])('exposes %p', controller => {
    const controllers = Reflect.getMetadata(
      'controllers',
      FleetModule,
    ) as unknown[];

    expect(controllers).toContain(controller);
  });

  /**
   * The browse surface. Listed separately from the nested controllers
   * because it is the one place that decides what an anonymous caller may
   * see, and a module that stopped registering it would answer 404 for
   * every directory page while every other Fleet route kept working.
   */
  it('exposes the three public directories', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      FleetModule,
    ) as unknown[];

    expect(controllers).toContain(FleetDirectoryController);
  });

  it('exposes the canonical URL resolver', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      FleetModule,
    ) as unknown[];

    expect(controllers).toContain(FleetScopeResolutionController);
  });

  /**
   * The mappers are provided and deliberately not exported. Another module
   * wanting a Community or a Fleet in its own shape should say so in its own
   * DTO rather than borrow this feature's presentation.
   */
  it.each([FleetCommunityMapper, StoFleetMapper, StoArmadaMapper])(
    'provides %p without exporting it',
    mapper => {
      const providers = Reflect.getMetadata(
        'providers',
        FleetModule,
      ) as unknown[];
      const exported = Reflect.getMetadata('exports', FleetModule) as unknown[];

      expect(providers).toContain(mapper);
      expect(exported).not.toContain(mapper);
    },
  );

  it('is not registered globally', () => {
    expect(Reflect.getMetadata('__module:global__', FleetModule)).toBeFalsy();
  });

  // ADR-0008. FleetModule may depend on the social graph; the social graph must
  // never depend on Fleet. Reading CommunityModule's own metadata is what makes
  // this a test of the boundary rather than a restatement of this module.
  it('is not imported by the social-graph module', () => {
    const communityImports = Reflect.getMetadata('imports', CommunityModule) as
      unknown[] | undefined;

    expect(communityImports ?? []).not.toContain(FleetModule);
  });
});
