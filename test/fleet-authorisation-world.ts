import { ClsService } from 'nestjs-cls';
import { FindOperator, Repository } from 'typeorm';

import { FleetAudienceService } from '../src/fleet/authorisation/fleet-audience.service';
import { FleetAuthorisationRevisionService } from '../src/fleet/authorisation/fleet-authorisation-revision.service';
import { FleetAuthorisationService } from '../src/fleet/authorisation/fleet-authorisation.service';
import { CommunitySubscriptionEntity } from '../src/fleet/entities/community-subscription.entity';
import { FleetCommunityEntity } from '../src/fleet/entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../src/fleet/entities/scope-capability-grant.entity';
import { ScopeMembershipEntity } from '../src/fleet/entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../src/fleet/entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../src/fleet/entities/sto-armada.entity';
import { StoFleetEntity } from '../src/fleet/entities/sto-fleet.entity';
import { UserEntity } from '../src/user/entities/user.entity';

/**
 * An in-memory stand-in for the rows the Fleet authorisation policy reads.
 *
 * The policy is a set of rules about how several tables combine, so testing it
 * one mocked `findOne` at a time would mostly test the mocks: each rule would
 * be asserted against the exact call it makes rather than against the situation
 * it is about. Here a test describes a world — these Communities, these Fleets,
 * this person with this role — and asks the real services real questions.
 *
 * It lives under `test/` rather than `src/` so it is not measured for coverage;
 * it is scaffolding, not shipped code.
 */

/** Anything the fake repositories can hold. */
type Row = Record<string, unknown>;

/** A `where` clause, or a list of them meaning "any of these". */
type Where = Row | Row[];

/**
 * Reports whether one stored value satisfies one condition.
 *
 * Supports the two TypeORM operators the policy uses — `IsNull()` and
 * `Not(IsNull())` — and plain equality for everything else. An operator the
 * policy does not use throws rather than guessing, so adding one to the service
 * without teaching this harness fails loudly instead of matching everything.
 *
 * @param actual - The value on the row.
 * @param expected - The value or operator in the `where` clause.
 * @returns True when the row satisfies it.
 */
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    if (expected.type === 'isNull') {
      return actual === null || actual === undefined;
    }

    if (expected.type === 'not') {
      return !matchesValue(actual, expected.child ?? expected.value);
    }

    throw new Error(`Unsupported find operator '${expected.type}'`);
  }

  return actual === expected;
}

/**
 * Reports whether a row satisfies a `where` clause.
 *
 * @param row - The stored row.
 * @param where - The clause, or a list of clauses meaning "any of these".
 * @returns True when the row matches.
 */
function matchesWhere(row: Row, where: Where | undefined): boolean {
  if (where === undefined) {
    return true;
  }

  if (Array.isArray(where)) {
    return where.some(clause => matchesWhere(row, clause));
  }

  return Object.entries(where).every(([key, expected]) =>
    matchesValue(row[key], expected),
  );
}

/** The repository surface the authorisation services actually use. */
export class InMemoryRepository<T extends Row> {
  /**
   * Creates an in-memory repository.
   *
   * @param rows - The rows it holds. Mutated in place by `increment`.
   */
  constructor(readonly rows: T[]) {}

  /**
   * Finds every matching row.
   *
   * @param options - The find options.
   * @returns The matching rows.
   */
  find(options?: { where?: Where }): Promise<T[]> {
    return Promise.resolve(
      this.rows.filter(row => matchesWhere(row, options?.where)),
    );
  }

  /**
   * Finds the first matching row.
   *
   * @param options - The find options.
   * @returns The row, or null.
   */
  findOne(options: { where?: Where }): Promise<T | null> {
    return Promise.resolve(
      this.rows.find(row => matchesWhere(row, options.where)) ?? null,
    );
  }

  /**
   * Adds to a numeric column on every matching row.
   *
   * @param criteria - Which rows to change.
   * @param column - The column to add to.
   * @param by - How much to add.
   */
  increment(criteria: Row, column: string, by: number): Promise<void> {
    for (const row of this.rows.filter(candidate =>
      matchesWhere(candidate, criteria),
    )) {
      (row as Row)[column] = ((row[column] as number) ?? 0) + by;
    }

    return Promise.resolve();
  }
}

/** The rows a test wants in the world. Anything omitted is empty. */
export interface WorldRows {
  users?: Partial<UserEntity>[];
  communities?: Partial<FleetCommunityEntity>[];
  fleets?: Partial<StoFleetEntity>[];
  armadas?: Partial<StoArmadaEntity>[];
  memberships?: Partial<ScopeMembershipEntity>[];
  roles?: Partial<ScopeRoleAssignmentEntity>[];
  grants?: Partial<ScopeCapabilityGrantEntity>[];
  subscriptions?: Partial<CommunitySubscriptionEntity>[];
}

/** The services under test, wired to the world's rows. */
export interface AuthorisationWorld {
  authorisation: FleetAuthorisationService;
  audience: FleetAudienceService;
  revision: FleetAuthorisationRevisionService;
  rows: Required<WorldRows>;
}

/**
 * Fills in the nullable scope columns a row may omit.
 *
 * Tests name only the column they mean — a Fleet-scoped role gives `fleetId`
 * and nothing else — and the policy reads both, because "neither is set" is
 * what makes a row Community-wide.
 *
 * @param rows - The partial rows.
 * @returns The same rows with the scope columns present.
 */
function withScopeColumns<T extends Row>(rows: T[]): T[] {
  return rows.map(row => ({
    fleetId: null,
    armadaId: null,
    deletedAt: null,
    ...row,
  }));
}

/**
 * Builds the authorisation services over a described world.
 *
 * @param rows - The rows the world contains.
 * @param clsActive - Whether a request context is active, which decides whether
 *   answers are memoised. Off by default so a test that changes a row between
 *   two questions sees the change.
 * @returns The wired services and the row arrays, which stay live.
 */
export function createAuthorisationWorld(
  rows: WorldRows,
  clsActive = false,
): AuthorisationWorld {
  const store = new Map<string, unknown>();
  const cls = {
    isActive: () => clsActive,
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => store.set(key, value),
  } as unknown as ClsService;

  const filled: Required<WorldRows> = {
    users: rows.users ?? [],
    communities: (rows.communities ?? []).map(row => ({
      deletedAt: null,
      ...row,
    })),
    fleets: (rows.fleets ?? []).map(row => ({ deletedAt: null, ...row })),
    armadas: (rows.armadas ?? []).map(row => ({ deletedAt: null, ...row })),
    memberships: withScopeColumns(rows.memberships ?? []),
    roles: withScopeColumns(rows.roles ?? []).map(row => ({
      validTo: null,
      ...row,
    })),
    grants: withScopeColumns(rows.grants ?? []).map(row => ({
      validTo: null,
      subjectUserId: null,
      subjectRole: null,
      ...row,
    })),
    subscriptions: (rows.subscriptions ?? []).map(row => ({
      leftAt: null,
      deletedAt: null,
      ...row,
    })),
  };

  const repository = <T extends Row>(source: unknown): Repository<never> =>
    new InMemoryRepository(source as T[]) as unknown as Repository<never>;

  const authorisation = new FleetAuthorisationService(
    repository(filled.communities),
    repository(filled.fleets),
    repository(filled.armadas),
    repository(filled.memberships),
    repository(filled.roles),
    repository(filled.grants),
    repository(filled.users),
    cls,
  );

  return {
    authorisation,
    audience: new FleetAudienceService(
      authorisation,
      repository(filled.subscriptions),
    ),
    revision: new FleetAuthorisationRevisionService(
      repository(filled.communities),
      repository(filled.fleets),
      repository(filled.armadas),
      authorisation,
    ),
    rows: filled,
  };
}
