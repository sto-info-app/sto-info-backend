import {
  buildCloudflareImageUrl,
  isValidCloudflareImageUrl,
} from 'src/shared/constants/image.constants';

/**
 * Cloudflare Images id used when no platform-launcher mapping resolves.
 */
export const FALLBACK_ACCOUNT_TYPE_IMAGE_ID =
  '8ab52131-6f11-408a-d9df-3c1acaa46d00';

/**
 * The subset of an account needed to resolve its card background image.
 */
export interface AccountImageSource {
  platformId?: string | null;
  launcherId?: string | null;
}

/**
 * Builds a deterministic lookup key for platform-launcher mappings.
 *
 * @param platformId - Optional platform ID.
 * @param launcherId - Optional launcher ID.
 * @returns A deterministic key in the format `<platformId>|<launcherId>`.
 */
export function buildPlatformLauncherLookupKey(
  platformId?: string | null,
  launcherId?: string | null,
): string {
  return `${platformId ?? ''}|${launcherId ?? ''}`;
}

/**
 * A platform-launcher mapping row, reduced to the fields needed for lookup.
 */
export interface PlatformLauncherImageMapping {
  platformId?: string | null;
  launcherId?: string | null;
  backgroundImageUrl: string | null;
}

/**
 * Builds the platform-launcher background image lookup, skipping any mapping
 * whose URL is not a valid Cloudflare image URL.
 *
 * @param mappings - The platform-launcher mapping rows.
 * @returns A map from lookup key to background image URL.
 */
export function buildAccountBackgroundImageLookup(
  mappings: PlatformLauncherImageMapping[],
): Map<string, string> {
  const backgroundImageLookup = new Map<string, string>();

  for (const mapping of mappings) {
    if (!isValidCloudflareImageUrl(mapping.backgroundImageUrl)) {
      continue;
    }

    const key = buildPlatformLauncherLookupKey(
      mapping.platformId,
      mapping.launcherId,
    );
    backgroundImageLookup.set(key, mapping.backgroundImageUrl);
  }

  return backgroundImageLookup;
}

/**
 * Resolves the account card background URL from platform-launcher mappings.
 *
 * Resolution order:
 * 1) Exact platform + launcher
 * 2) Platform default (platform + null launcher)
 * 3) Launcher default (null platform + launcher)
 * 4) Global default (null platform + null launcher)
 * 5) Static fallback URL
 *
 * @param account - The account to resolve for.
 * @param backgroundImageLookup - A mapping from lookup key to URL.
 * @returns The selected account background image URL.
 */
export function resolveAccountTypeImageUrl(
  account: AccountImageSource,
  backgroundImageLookup: Map<string, string>,
): string {
  const candidateKeys = [
    buildPlatformLauncherLookupKey(account.platformId, account.launcherId),
    buildPlatformLauncherLookupKey(account.platformId, null),
    buildPlatformLauncherLookupKey(null, account.launcherId),
    buildPlatformLauncherLookupKey(null, null),
  ];

  for (const key of candidateKeys) {
    const match = backgroundImageLookup.get(key);
    if (match) {
      return match;
    }
  }

  return buildCloudflareImageUrl(FALLBACK_ACCOUNT_TYPE_IMAGE_ID, 'public');
}
