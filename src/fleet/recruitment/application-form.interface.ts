import { ApplicationQuestionKind } from './enums/application-question-kind.enum';

/** The most questions one form may ask. */
export const MAX_APPLICATION_QUESTIONS = 20;

/** The most options a single-choice question may offer. */
export const MAX_QUESTION_OPTIONS = 10;

/** How long a question's prompt may be. */
export const MAX_QUESTION_PROMPT_LENGTH = 300;

/** How long one option of a single-choice question may be. */
export const MAX_QUESTION_OPTION_LENGTH = 100;

/** How long an answer to each kind of text question may be. */
export const MAX_ANSWER_LENGTH: Readonly<
  Record<
    ApplicationQuestionKind.SHORT_TEXT | ApplicationQuestionKind.LONG_TEXT,
    number
  >
> = {
  [ApplicationQuestionKind.SHORT_TEXT]: 200,
  [ApplicationQuestionKind.LONG_TEXT]: 2000,
};

/**
 * One question on a Fleet's application form, as a settings version keeps it.
 *
 * A question's `id` is minted when the form is saved and carried into every
 * later version that keeps the question, so an answer names the question it
 * answered rather than a position that later edits may move.
 */
export interface ApplicationQuestion {
  /** The question, stable across versions that keep it. */
  readonly id: string;
  readonly kind: ApplicationQuestionKind;
  /** What is asked. */
  readonly prompt: string;
  /** Whether an application may leave it unanswered. */
  readonly required: boolean;
  /** The options, for a single-choice question, and empty otherwise. */
  readonly options: readonly string[];
}

/**
 * One answer on a submitted application.
 *
 * Text for a text question, one of the options for a single choice, and
 * `true` or `false` for yes or no. An unanswered optional question has no
 * entry at all.
 */
export interface ApplicationAnswer {
  /** The question answered. */
  readonly questionId: string;
  readonly value: string | boolean;
}
