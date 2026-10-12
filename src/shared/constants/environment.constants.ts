/**
 * The names `NODE_ENV` may take, and what each one means for the code that
 * has to behave differently by environment.
 *
 * Everything that branches on the environment name reads it from here, so a
 * new environment is added in one place and every check learns about it at
 * once. The names are deliberately short because the image uploader uses the
 * name as the first folder of every object key, which is how an environment
 * keeps its files apart from the others.
 */

/** A developer's own machine. */
export const NODE_ENV_LOCAL = 'local';

/**
 * A disposable stack built for an end-to-end scan: its own database, Redis,
 * backend and frontend on one runner, thrown away afterwards. It behaves like
 * `local` but keeps its uploads in a folder of its own.
 */
export const NODE_ENV_E2E_TEST = 'e2etest';

/** The shared Development deployment. */
export const NODE_ENV_DEV = 'dev';

/** A staging deployment. */
export const NODE_ENV_STAGING = 'staging';

/** The Production deployment. */
export const NODE_ENV_PROD = 'prod';

/** Every name `NODE_ENV` is allowed to take. */
export const NODE_ENVIRONMENTS = [
  NODE_ENV_LOCAL,
  NODE_ENV_E2E_TEST,
  NODE_ENV_DEV,
  NODE_ENV_STAGING,
  NODE_ENV_PROD,
] as const;

/** One of the allowed `NODE_ENV` names. */
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/**
 * Environments that run on the same machine as their database and browser:
 * no TLS to the database, no proxy in front of the server, Swagger allowed.
 */
export const ON_MACHINE_ENVIRONMENTS: readonly NodeEnvironment[] = [
  NODE_ENV_LOCAL,
  NODE_ENV_E2E_TEST,
];

/** Environments that load the demonstration accounts. */
export const DEMO_DATA_ENVIRONMENTS: readonly NodeEnvironment[] = [
  NODE_ENV_LOCAL,
  NODE_ENV_E2E_TEST,
  NODE_ENV_DEV,
  NODE_ENV_STAGING,
];

/**
 * Reads an environment name the way every check should: trimmed and in
 * lower case, so `Local` and `local ` mean the same thing.
 *
 * @param value - The raw `NODE_ENV` value, usually `process.env.NODE_ENV`.
 * @returns The normalised name, or an empty string when nothing is set.
 */
export function normaliseEnvironment(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Whether the environment runs on the same machine as its database and
 * browser. See {@link ON_MACHINE_ENVIRONMENTS}.
 *
 * @param value - The raw `NODE_ENV` value.
 * @returns True for `local` and `e2etest`.
 */
export function isOnMachineEnvironment(value: string | undefined): boolean {
  return (ON_MACHINE_ENVIRONMENTS as readonly string[]).includes(
    normaliseEnvironment(value),
  );
}

/**
 * Whether the environment loads the demonstration accounts. See
 * {@link DEMO_DATA_ENVIRONMENTS}.
 *
 * @param value - The raw `NODE_ENV` value.
 * @returns True for every environment except Production.
 */
export function loadsDemoData(value: string | undefined): boolean {
  return (DEMO_DATA_ENVIRONMENTS as readonly string[]).includes(
    normaliseEnvironment(value),
  );
}

/**
 * Whether the environment is Production.
 *
 * @param value - The raw `NODE_ENV` value.
 * @returns True only for `prod`.
 */
export function isProductionEnvironment(value: string | undefined): boolean {
  return normaliseEnvironment(value) === NODE_ENV_PROD;
}
