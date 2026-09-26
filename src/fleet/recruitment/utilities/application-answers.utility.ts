import { BadRequestException } from '@nestjs/common';

import {
  ApplicationAnswer,
  ApplicationQuestion,
  MAX_ANSWER_LENGTH,
} from '../application-form.interface';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';

/** An answer as an applicant sent it, before it is checked. */
export interface SubmittedAnswer {
  readonly questionId: string;
  readonly value: unknown;
}

/**
 * Checks an application's answers against the form it answers, and returns
 * them as they are kept.
 *
 * Text is trimmed, and text left blank counts as unanswered. A choice must be
 * one of the question's options exactly; a yes or no must be a boolean. Every
 * required question must be answered, and an answer to a question the form
 * does not ask is refused rather than kept. The answers come back in the
 * form's order, so a decider reads them as the applicant did.
 *
 * @param questions - The form's questions.
 * @param submitted - The answers sent.
 * @returns The answers to keep.
 * @throws BadRequestException naming the first thing wrong.
 */
export function validateAnswers(
  questions: readonly ApplicationQuestion[],
  submitted: readonly SubmittedAnswer[],
): ApplicationAnswer[] {
  const byId = new Map<string, SubmittedAnswer>();

  for (const answer of submitted) {
    if (!questions.some(question => question.id === answer.questionId)) {
      throw new BadRequestException(
        'That answer is for a question this form does not ask. Reload the form and try again.',
      );
    }

    if (byId.has(answer.questionId)) {
      throw new BadRequestException('A question was answered twice.');
    }

    byId.set(answer.questionId, answer);
  }

  const kept: ApplicationAnswer[] = [];

  for (const question of questions) {
    const value = readAnswer(question, byId.get(question.id)?.value);

    if (value === null) {
      if (question.required) {
        throw new BadRequestException(`Please answer: ${question.prompt}`);
      }

      continue;
    }

    kept.push({ questionId: question.id, value });
  }

  return kept;
}

/**
 * Reads one answer as its question's kind requires.
 *
 * @param question - The question.
 * @param value - What was sent for it, if anything.
 * @returns The answer to keep, or null when it was left unanswered.
 * @throws BadRequestException when it is the wrong kind of answer.
 */
function readAnswer(
  question: ApplicationQuestion,
  value: unknown,
): string | boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  switch (question.kind) {
    case ApplicationQuestionKind.YES_NO:
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `Please answer yes or no: ${question.prompt}`,
        );
      }

      return value;

    case ApplicationQuestionKind.SINGLE_CHOICE:
      if (typeof value !== 'string' || value === '') {
        return value === '' ? null : invalidChoice(question);
      }

      return question.options.includes(value) ? value : invalidChoice(question);

    case ApplicationQuestionKind.SHORT_TEXT:
    case ApplicationQuestionKind.LONG_TEXT: {
      if (typeof value !== 'string') {
        throw new BadRequestException(
          `Please answer in words: ${question.prompt}`,
        );
      }

      const text = value.trim();

      if (text.length > MAX_ANSWER_LENGTH[question.kind]) {
        throw new BadRequestException(
          `That answer is longer than ${MAX_ANSWER_LENGTH[question.kind]} characters: ${question.prompt}`,
        );
      }

      return text === '' ? null : text;
    }
  }
}

/**
 * Refuses a choice that is not one of the question's options.
 *
 * @param question - The question.
 * @returns Never.
 * @throws BadRequestException always.
 */
function invalidChoice(question: ApplicationQuestion): never {
  throw new BadRequestException(
    `Please choose one of the options for: ${question.prompt}`,
  );
}
