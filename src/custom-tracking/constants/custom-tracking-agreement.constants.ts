import {
  CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
  CUSTOM_TRACKING_POLICY_UPDATED_DATE,
  CUSTOM_TRACKING_POLICY_VERSION,
} from './custom-tracking-policy.constants';

/**
 * One part of the agreement a user reads before accepting it.
 *
 * Held as structured content rather than as a block of HTML so the interface
 * can present it in the site's own styling, and so a screen reader meets a
 * heading and a list rather than a paragraph containing bullet characters.
 */
export interface CustomTrackingAgreementSection {
  /** The section's heading, or null where the text stands on its own. */
  readonly heading: string | null;
  /** Paragraphs, in order. */
  readonly paragraphs: readonly string[];
  /** Bulleted points following the paragraphs, in order. */
  readonly bullets: readonly string[];
}

/** The agreement as the interface receives it. */
export interface CustomTrackingAgreement {
  /** The version a user's acceptance is recorded against. */
  readonly version: string;
  /** When this wording took effect, as an ISO date. */
  readonly effectiveDate: string;
  /** When this wording was last changed, as an ISO date. */
  readonly updatedDate: string;
  /** The agreement's title. */
  readonly title: string;
  /** The agreement's content, in reading order. */
  readonly sections: readonly CustomTrackingAgreementSection[];
}

/**
 * The Custom Tracking Content Agreement.
 *
 * Held in the application rather than the database, alongside the version
 * constant it is published under, so the wording and the version that records
 * a user's acceptance of it can only change together. A version raised without
 * the text changing, or text changed without the version moving, would leave
 * an acceptance record that does not say what was agreed.
 *
 * The wording deliberately does not claim that prohibited content can be
 * prevented. Free text and uploaded pictures cannot be made to refuse personal
 * information, and an agreement that implied otherwise would be misleading
 * about what the site is actually able to do.
 */
export const CUSTOM_TRACKING_AGREEMENT: CustomTrackingAgreement = {
  version: CUSTOM_TRACKING_POLICY_VERSION,
  effectiveDate: CUSTOM_TRACKING_POLICY_EFFECTIVE_DATE,
  updatedDate: CUSTOM_TRACKING_POLICY_UPDATED_DATE,
  title: 'Custom Tracking Content Agreement',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Custom tracking lets you create your own sections, tabs, fields, and values for your Star Trek Online accounts and characters. You are responsible for everything you enter or upload.',
      ],
      bullets: [],
    },
    {
      heading: 'What you must not store or publish',
      paragraphs: ['You must not use custom tracking to store or publish:'],
      bullets: [
        'personal information about yourself or another person, including contact details, financial information, account credentials, passwords, authentication codes, or other sensitive information;',
        'illegal, threatening, abusive, hateful, discriminatory, sexually explicit, or otherwise prohibited content;',
        'malware or material intended to damage or disrupt the service;',
        'content that infringes copyright, trademarks, privacy rights, or other legal rights;',
        'spam, advertising, scams, impersonation, unauthorised commercial activity, or deliberately misleading content.',
      ],
    },
    {
      heading: 'Who can see what you enter',
      paragraphs: [
        'Information is private by default. If you choose to make a section, tab, or field public, its value may appear on your public STO Info profile, subject to your profile and related STO Account or Character also being publicly visible. Public information may be indexed by search engines.',
      ],
      bullets: [],
    },
    {
      heading: 'Enforcement',
      paragraphs: [
        'Public content may be reviewed, hidden, or removed. Serious or repeated breaches may result in your STO Info account being suspended or permanently banned.',
      ],
      bullets: [],
    },
    {
      heading: null,
      paragraphs: [
        'By selecting I agree, you confirm that you have read and will follow the Terms of Use and these Custom Tracking Content Rules.',
      ],
      bullets: [],
    },
  ],
};
