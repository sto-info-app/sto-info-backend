import { randomUUID } from 'node:crypto';

import { DataSource, EntityManager, FindOperator } from 'typeorm';

/**
 * An in-memory stand-in for the `EntityManager` calls the Armada services
 * (FC-024 to FC-026) and the event services (FC-028) make.
 *
 * The placement rules combine several tables, so a spec that mocked one call
 * at a time would mostly test its own mocks. Here a spec describes the rows —
 * these Fleets, placed so — and runs the real services against them.
 *
 * It lives under `test/` rather than `src/` so it is not measured for
 * coverage; it is scaffolding, not shipped code. An operator or option the
 * services do not use throws rather than guessing, so teaching a service a
 * new query without teaching this fails loudly.
 */

/** Anything a table here can hold. */
export type Row = Record<string, unknown>;

/** An entity class, which names its table. */
type EntityClass = abstract new () => unknown;

/** A `where` clause, or a list of them meaning "any of these". */
type Where = Row | Row[];

/** What a find may ask for. */
interface FindOptions {
  where?: Where;
  order?: Record<string, 'ASC' | 'DESC'>;
  skip?: number;
  take?: number;
  lock?: unknown;
  select?: unknown;
  relations?: unknown;
}

/** The operators that compare, which a NULL never satisfies. */
const ORDERINGS: ReadonlySet<string> = new Set([
  'lessThan',
  'lessThanOrEqual',
  'moreThan',
  'moreThanOrEqual',
  'between',
]);

/**
 * Reports whether a stored value satisfies one condition.
 *
 * @param actual - The value on the row.
 * @param expected - The value or operator in the clause.
 * @returns True when it does.
 */
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    const operand: unknown = expected.value;

    // As SQL: a NULL is neither before nor after anything.
    if (
      ORDERINGS.has(expected.type) &&
      (actual === null || actual === undefined)
    ) {
      return false;
    }

    switch (expected.type) {
      case 'isNull':
        return actual === null || actual === undefined;
      case 'not':
        return !matchesValue(actual, expected.child ?? operand);
      case 'in':
        return (operand as unknown[]).includes(actual);
      case 'equal':
        return matchesValue(actual, operand);
      case 'lessThanOrEqual':
        return (actual as Date) <= (operand as Date);
      case 'moreThanOrEqual':
        return (actual as Date) >= (operand as Date);
      case 'and':
        return (operand as FindOperator<unknown>[]).every(each =>
          matchesValue(actual, each),
        );
      case 'ilike':
        return likePattern(operand as string).test(String(actual));
      case 'moreThan':
        return (actual as Date) > (operand as Date);
      case 'lessThan':
        return (actual as Date) < (operand as Date);
      case 'between': {
        const [low, high] = operand as [Date, Date];

        return (actual as Date) >= low && (actual as Date) <= high;
      }
      default:
        throw new Error(`Unsupported find operator '${expected.type}'`);
    }
  }

  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }

  return actual === expected;
}

/**
 * Reports whether a row satisfies a clause.
 *
 * @param row - The row.
 * @param where - The clause.
 * @returns True when it does.
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

/**
 * Turns an ILIKE pattern into a regular expression: `%` for any run, and a
 * backslash escaping the next character, as the SQL does.
 *
 * @param pattern - The pattern.
 * @returns The expression, case-insensitive.
 */
function likePattern(pattern: string): RegExp {
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === '\\') {
      index += 1;
      source += escapeForPattern(pattern[index]);
    } else if (character === '%') {
      source += '.*';
    } else {
      source += escapeForPattern(character);
    }
  }

  return new RegExp(`^${source}$`, 'i');
}

/**
 * Escapes one character for a regular expression.
 *
 * @param character - The character.
 * @returns It, meaning only itself.
 */
function escapeForPattern(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compares two values for sorting.
 *
 * @param a - One.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
function compare(a: unknown, b: unknown): number {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;

  if (left === right) {
    return 0;
  }

  return (left as number) < (right as number) ? -1 : 1;
}

/**
 * Whether a row would break the unique key a new one has.
 *
 * @param row - One already there.
 * @param value - The new one.
 * @returns True when they share a dedupe or idempotency key.
 */
function sameKey(row: Row, value: Row): boolean {
  // A null key is outside the index, as PostgreSQL's partial and plain unique
  // indexes both treat it: two nulls never clash.
  return (['dedupeKey', 'idempotencyKey'] as const).some(
    key =>
      value[key] !== undefined &&
      value[key] !== null &&
      row[key] === value[key],
  );
}

/** The manager, and what it was asked to do. */
export class InMemoryManager {
  /** Every table's rows, by entity class. */
  readonly tables = new Map<EntityClass, Row[]>();

  /** Every increment asked for, in order. */
  readonly increments: { entity: EntityClass; where: Row }[] = [];

  /** Every lock asked for, by entity class. */
  readonly locks: EntityClass[] = [];

  /** The unique keys an insert that ignores conflicts respects, by table. */
  private readonly _uniqueKeys = new Map<
    EntityClass,
    (row: Row) => string | null
  >();

  /** The column defaults an insert fills in, by table. */
  private readonly _defaults = new Map<EntityClass, Row>();

  /**
   * Gives a table column defaults, as the database would fill in on an
   * insert that leaves them out.
   *
   * @param entity - Its entity class.
   * @param values - Each column's default.
   * @returns This, for chaining.
   */
  defaults(entity: EntityClass, values: Row): this {
    this._defaults.set(entity, values);

    return this;
  }

  /**
   * Gives a table a unique key, as an index would, for inserts that ignore
   * a conflict.
   *
   * @param entity - Its entity class.
   * @param keyOf - The key of a row, or null for a row the index skips.
   * @returns This, for chaining.
   */
  unique(entity: EntityClass, keyOf: (row: Row) => string | null): this {
    this._uniqueKeys.set(entity, keyOf);

    return this;
  }

  /**
   * Seeds a table.
   *
   * @param entity - Its entity class.
   * @param rows - The rows.
   * @returns This, for chaining.
   */
  seed(entity: EntityClass, rows: Row[]): this {
    this.rows(entity).push(...rows);

    return this;
  }

  /**
   * A table's rows.
   *
   * @param entity - Its entity class.
   * @returns The live array.
   */
  rows<T extends Row = Row>(entity: EntityClass): T[] {
    if (!this.tables.has(entity)) {
      this.tables.set(entity, []);
    }

    return this.tables.get(entity) as T[];
  }

  find = (entity: EntityClass, options: FindOptions = {}): Promise<Row[]> =>
    Promise.resolve(this.select(entity, options));

  findOne = (
    entity: EntityClass,
    options: FindOptions,
  ): Promise<Row | null> => {
    if (options.lock !== undefined) {
      this.locks.push(entity);
    }

    return Promise.resolve(this.select(entity, options)[0] ?? null);
  };

  findAndCount = (
    entity: EntityClass,
    options: FindOptions,
  ): Promise<[Row[], number]> =>
    Promise.resolve([
      this.select(entity, options),
      this.select(entity, { where: options.where }).length,
    ]);

  count = (entity: EntityClass, options: FindOptions = {}): Promise<number> =>
    Promise.resolve(this.select(entity, { where: options.where }).length);

  exists = (entity: EntityClass, options: FindOptions): Promise<boolean> =>
    Promise.resolve(this.select(entity, { where: options.where }).length > 0);

  create = (_entity: EntityClass, values: Row): Row => ({ ...values });

  save = (
    entityOrRow: EntityClass | Row,
    maybeRow?: Row | Row[],
  ): Promise<Row | Row[]> => {
    const entity = entityOrRow as EntityClass;

    if (maybeRow === undefined) {
      throw new Error('save needs the entity class here');
    }

    if (Array.isArray(maybeRow)) {
      return Promise.all(
        maybeRow.map(row => this.save(entity, row) as Promise<Row>),
      );
    }

    const row = maybeRow;

    row.id ??= randomUUID();

    const rows = this.rows(entity);

    if (!rows.includes(row)) {
      const existing = rows.findIndex(candidate => candidate.id === row.id);

      if (existing >= 0) {
        rows[existing] = row;
      } else {
        rows.push(row);
      }
    }

    return Promise.resolve(row);
  };

  insert = (entity: EntityClass, values: Row | Row[]): Promise<void> => {
    for (const value of Array.isArray(values) ? values : [values]) {
      this.rows(entity).push({ id: randomUUID(), ...value });
    }

    return Promise.resolve();
  };

  update = (
    entity: EntityClass,
    where: Where,
    values: Row,
  ): Promise<{ affected: number }> => {
    const matched = this.rows(entity).filter(row => matchesWhere(row, where));

    for (const row of matched) {
      Object.assign(row, values);
    }

    return Promise.resolve({ affected: matched.length });
  };

  upsert = (
    entity: EntityClass,
    values: Row[],
    conflictPaths: string[],
  ): Promise<void> => {
    for (const value of values) {
      const existing = this.rows(entity).find(row =>
        conflictPaths.every(path => row[path] === value[path]),
      );

      if (existing) {
        Object.assign(existing, value);
      } else {
        this.rows(entity).push({ ...value });
      }
    }

    return Promise.resolve();
  };

  remove = (entity: EntityClass, row: Row): Promise<Row> => {
    const rows = this.rows(entity);

    rows.splice(rows.indexOf(row), 1);

    return Promise.resolve(row);
  };

  delete = (entity: EntityClass, where: Row): Promise<{ affected: number }> => {
    const rows = this.rows(entity);
    const kept = rows.filter(row => !matchesWhere(row, where));
    const affected = rows.length - kept.length;

    rows.splice(0, rows.length, ...kept);

    return Promise.resolve({ affected });
  };

  /**
   * The one query builder the services use: an insert that ignores a row
   * whose `dedupeKey` or `idempotencyKey` is already there, as the outbox's
   * and the activity feed's unique keys make PostgreSQL do.
   *
   * @returns The builder.
   */
  createQueryBuilder = () => {
    let target: EntityClass;
    let values: Row[] = [];
    let ignore = false;
    const builder = {
      insert: () => builder,
      into: (entity: EntityClass) => {
        target = entity;

        return builder;
      },
      values: (rows: Row | Row[]) => {
        values = Array.isArray(rows) ? rows : [rows];

        return builder;
      },
      orIgnore: () => {
        ignore = true;

        return builder;
      },
      execute: () => {
        const rows = this.rows(target);
        const keyOf = this._uniqueKeys.get(target);
        const clashes = (row: Row, value: Row): boolean =>
          sameKey(row, value) ||
          (keyOf !== undefined &&
            keyOf(value) !== null &&
            keyOf(row) === keyOf(value));

        for (const value of values) {
          if (!ignore || !rows.some(row => clashes(row, value))) {
            rows.push({
              id: randomUUID(),
              ...this._defaults.get(target),
              ...value,
            });
          }
        }

        return Promise.resolve();
      },
    };

    return builder;
  };

  increment = (entity: EntityClass, where: Row): Promise<void> => {
    this.increments.push({ entity, where });

    return Promise.resolve();
  };

  /**
   * The manager as a service expects it.
   *
   * @returns This, typed.
   */
  asManager(): EntityManager {
    return this as unknown as EntityManager;
  }

  /**
   * A data source whose transactions run on this manager.
   *
   * @returns The data source.
   */
  asDataSource(): DataSource {
    return {
      manager: this,
      transaction: (work: (manager: InMemoryManager) => Promise<unknown>) =>
        work(this),
    } as unknown as DataSource;
  }

  /**
   * Reads rows, in order and paged.
   *
   * @param entity - The table.
   * @param options - What to read.
   * @returns The rows.
   */
  private select(entity: EntityClass, options: FindOptions): Row[] {
    let rows = this.rows(entity).filter(row =>
      matchesWhere(row, options.where),
    );

    if (options.order) {
      const order = Object.entries(options.order);

      rows = [...rows].sort((a, b) => {
        for (const [key, direction] of order) {
          const result = compare(a[key], b[key]);

          if (result !== 0) {
            return direction === 'DESC' ? -result : result;
          }
        }

        return 0;
      });
    }

    const skip = options.skip ?? 0;

    return rows.slice(
      skip,
      options.take === undefined ? undefined : skip + options.take,
    );
  }
}
