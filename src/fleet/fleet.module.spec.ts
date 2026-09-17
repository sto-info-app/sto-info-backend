import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getRepositoryToken } from '@nestjs/typeorm';

import { CommunityModule } from '../community/community.module';
import { ArmadaFleetMembershipEntity } from './entities/armada-fleet-membership.entity';
import { CharacterFleetMembershipEntity } from './entities/character-fleet-membership.entity';
import { CommunitySubscriptionEntity } from './entities/community-subscription.entity';
import { FleetCommunityEntity } from './entities/fleet-community.entity';
import { FleetNameAliasEntity } from './entities/fleet-name-alias.entity';
import { ScopeMembershipEntity } from './entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from './entities/scope-role-assignment.entity';
import { StoArmadaEntity } from './entities/sto-armada.entity';
import { StoFleetEntity } from './entities/sto-fleet.entity';
import { FleetModule } from './fleet.module';

interface FeatureModule {
  providers?: Array<{ provide?: unknown }>;
}

describe('FleetModule', () => {
  const ENTITIES = [
    FleetCommunityEntity,
    StoFleetEntity,
    StoArmadaEntity,
    FleetNameAliasEntity,
    ArmadaFleetMembershipEntity,
    CommunitySubscriptionEntity,
    ScopeMembershipEntity,
    ScopeRoleAssignmentEntity,
    CharacterFleetMembershipEntity,
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

    for (const entity of ENTITIES) {
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
    expect(registeredTokens()).toHaveLength(ENTITIES.length);
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
