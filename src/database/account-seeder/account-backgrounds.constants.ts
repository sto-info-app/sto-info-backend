/** Where the account card pictures are served from. */
const IMAGES =
  'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA';

/** One account card picture, and the platform and launcher it is for. */
export interface AccountBackground {
  /** The platform's name, or null for every platform. */
  readonly platform: string | null;
  /** The launcher's name, or null for every launcher. */
  readonly launcher: string | null;
  /** The picture. */
  readonly url: string;
}

/**
 * The account card pictures every environment starts with.
 *
 * The same pictures `PlatformLauncherBackgroundImageUrl1775200000000` gave
 * production and Development, whose platform and launcher rows existed by
 * then. On a database built from nothing they did not: the migrations run
 * before the seeder creates those rows, so the migration matched none of
 * them and every card fell back to the global default (found on tribble, 18
 * October 2026). The seeder gives them here instead, once it has made them.
 *
 * Windows with no launcher, and Windows by default, share a picture, as do
 * each console and its default.
 */
export const ACCOUNT_BACKGROUNDS: readonly AccountBackground[] = [
  {
    platform: 'Windows',
    launcher: 'Arc',
    url: `${IMAGES}/f7f4c0dc-6137-481d-86b9-d96b74737600/public`,
  },
  {
    platform: 'Windows',
    launcher: 'Epic',
    url: `${IMAGES}/65f8c1b1-72cc-4de0-21cc-74791b6f3900/public`,
  },
  {
    platform: 'Windows',
    launcher: 'Steam',
    url: `${IMAGES}/3e4517f1-6a07-4b68-bf80-710a70d8ff00/public`,
  },
  {
    platform: 'Windows',
    launcher: 'N/A',
    url: `${IMAGES}/4730a67a-1277-4cec-0792-7d858d875d00/public`,
  },
  {
    platform: 'PlayStation',
    launcher: 'N/A',
    url: `${IMAGES}/4a3443c5-1430-4139-0167-3eb19d135a00/public`,
  },
  {
    platform: 'Xbox',
    launcher: 'N/A',
    url: `${IMAGES}/df1a3c6f-25bd-4bfc-4541-8a4b097a9e00/public`,
  },
  {
    platform: 'Windows',
    launcher: null,
    url: `${IMAGES}/4730a67a-1277-4cec-0792-7d858d875d00/public`,
  },
  {
    platform: 'PlayStation',
    launcher: null,
    url: `${IMAGES}/4a3443c5-1430-4139-0167-3eb19d135a00/public`,
  },
  {
    platform: 'Xbox',
    launcher: null,
    url: `${IMAGES}/df1a3c6f-25bd-4bfc-4541-8a4b097a9e00/public`,
  },
  {
    platform: null,
    launcher: null,
    url: `${IMAGES}/8ab52131-6f11-408a-d9df-3c1acaa46d00/public`,
  },
];
