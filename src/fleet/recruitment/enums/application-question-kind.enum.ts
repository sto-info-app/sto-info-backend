/**
 * The kinds of question a Fleet's application form may ask (FC-021).
 *
 * Steve's choice of 26 September 2026. Answers are plain text or a choice;
 * nothing an applicant writes is ever rendered as Markdown or HTML.
 */
export enum ApplicationQuestionKind {
  /** One line, up to 200 characters. */
  SHORT_TEXT = 'SHORT_TEXT',
  /** A paragraph, up to 2,000 characters. */
  LONG_TEXT = 'LONG_TEXT',
  /** One of up to ten options the Fleet writes. */
  SINGLE_CHOICE = 'SINGLE_CHOICE',
  /** A yes or no, such as agreeing to the Fleet's rules. */
  YES_NO = 'YES_NO',
}
