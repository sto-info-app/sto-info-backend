import { jest } from '@jest/globals';
import { EntityManager, Repository } from 'typeorm';

import { StorytimeOrderingService } from '../../storytime/shared/storytime-ordering.service';
import { CustomTrackingDefinitionSupportService } from '../definitions/custom-tracking-definition-support.service';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';

/**
 * A repository stood in for, with every method the definition services use.
 */
export interface RepositoryDouble<T> {
  target: unknown;
  find: jest.Mock<(...args: unknown[]) => Promise<T[]>>;
  findOne: jest.Mock<(...args: unknown[]) => Promise<T | null>>;
  count: jest.Mock<(...args: unknown[]) => Promise<number>>;
  create: jest.Mock<(input: Partial<T>) => T>;
  save: jest.Mock<(entity: T) => Promise<T>>;
  update: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
}

/**
 * An entity manager stood in for, as a transaction body receives one.
 */
export interface EntityManagerDouble {
  find: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
  update: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  count: jest.Mock<(...args: unknown[]) => Promise<number>>;
}

/**
 * Builds a repository double.
 *
 * Shared rather than restated in each spec. Fifteen copies of the same six
 * mocks would be fifteen places to update when a service starts using a
 * seventh, and the copies would quietly diverge in what they return by
 * default — which is how a test comes to pass for the wrong reason.
 *
 * `create` returns what it was given, matching TypeORM: it builds an entity
 * from a partial without touching the database, so a service that reads back
 * what it just created is exercising its own logic rather than a mock's guess.
 *
 * @returns The double, and the same object typed as a repository.
 */
export function createRepositoryDouble<T extends object>(): {
  double: RepositoryDouble<T>;
  repository: Repository<T>;
} {
  const double: RepositoryDouble<T> = {
    target: {},
    find: jest.fn<(...args: unknown[]) => Promise<T[]>>().mockResolvedValue([]),
    findOne: jest
      .fn<(...args: unknown[]) => Promise<T | null>>()
      .mockResolvedValue(null),
    count: jest
      .fn<(...args: unknown[]) => Promise<number>>()
      .mockResolvedValue(0),
    create: jest.fn((input: Partial<T>) => ({ ...input }) as T),
    save: jest.fn((entity: T) => Promise.resolve(entity)),
    update: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(undefined),
  };

  return { double, repository: double as unknown as Repository<T> };
}

/**
 * Builds an entity manager double.
 *
 * @returns The double, and the same object typed as an entity manager.
 */
export function createEntityManagerDouble(): {
  double: EntityManagerDouble;
  manager: EntityManager;
} {
  const double: EntityManagerDouble = {
    find: jest
      .fn<(...args: unknown[]) => Promise<unknown[]>>()
      .mockResolvedValue([]),
    update: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(undefined),
    count: jest
      .fn<(...args: unknown[]) => Promise<number>>()
      .mockResolvedValue(0),
  };

  return { double, manager: double as unknown as EntityManager };
}

/**
 * Builds a data source whose transaction runs its body against a given
 * manager.
 *
 * Running the body rather than stubbing it out is the point: a service that
 * forgets to await inside a transaction, or that writes through the wrong
 * manager, only shows that up when the body actually runs.
 *
 * @param manager - The manager the transaction body should receive.
 * @returns Something shaped like a data source.
 */
export function createDataSourceDouble(manager: EntityManager): {
  manager: EntityManager;
  transaction: <R>(body: (manager: EntityManager) => Promise<R>) => Promise<R>;
} {
  return {
    manager,
    transaction: <R>(body: (entityManager: EntityManager) => Promise<R>) =>
      body(manager),
  };
}

/**
 * A real definition-support service, with its record-keeping stood in for.
 *
 * The support service is used as itself rather than mocked wherever the rules
 * it applies — ceilings, duplicate names, ordering — are part of what a test is
 * checking. Only its observability collaborator is a double, because a test
 * about creating a Tab has nothing to say about what gets logged.
 *
 * @returns The service, and the record of ceilings it reported.
 */
export function createSupportService(): {
  support: CustomTrackingDefinitionSupportService;
  limitReached: jest.Mock<(...args: unknown[]) => void>;
} {
  const limitReached = jest.fn<(...args: unknown[]) => void>();

  return {
    support: new CustomTrackingDefinitionSupportService(
      new StorytimeOrderingService(),
      {
        limitReached,
      } as unknown as CustomTrackingObservabilityService,
    ),
    limitReached,
  };
}
