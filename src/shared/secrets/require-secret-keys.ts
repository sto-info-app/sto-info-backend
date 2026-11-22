/**
 * Reads credentials from the application's AWS secret, refusing to go on
 * without them.
 *
 * `ConfigCheckService` validates environment variables, but it cannot see
 * inside the secret `AWS_SECRET_NAME` names. Without this, a client built from
 * a key that is missing gets `undefined` credentials and the API starts
 * looking healthy, failing only when someone first uploads a file or asks for
 * a transcript. Called from a provider factory, the error stops the start
 * instead, and names every missing key at once.
 *
 * @param secret - The parsed secret, as `SecretsService.getSecret` returns it.
 * @param keys - The keys that must be present.
 * @param purpose - What the keys are for, for the error message.
 * @returns The requested values, each a non-blank string.
 * @throws Error naming every key that is missing, blank or not a string.
 */
export function requireSecretKeys<K extends string>(
  secret: Record<string, unknown> | undefined,
  keys: readonly K[],
  purpose: string,
): Record<K, string> {
  const missing = keys.filter(key => {
    const value = secret?.[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing ${purpose} secret keys: ${missing.join(', ')}. Add them to the ` +
        'secret AWS_SECRET_NAME names (docs/environment-variables.md).',
    );
  }

  return Object.fromEntries(
    keys.map(key => [key, secret![key] as string]),
  ) as Record<K, string>;
}
