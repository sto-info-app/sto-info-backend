import { BadRequestException } from '@nestjs/common';

import { ApplicationQuestion } from '../application-form.interface';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';
import { validateAnswers } from './application-answers.utility';

const WHY: ApplicationQuestion = {
  id: 'why',
  kind: ApplicationQuestionKind.SHORT_TEXT,
  prompt: 'Why this Fleet?',
  required: true,
  options: [],
};
const ABOUT: ApplicationQuestion = {
  id: 'about',
  kind: ApplicationQuestionKind.LONG_TEXT,
  prompt: 'Tell us about yourself',
  required: false,
  options: [],
};
const TIMEZONE: ApplicationQuestion = {
  id: 'zone',
  kind: ApplicationQuestionKind.SINGLE_CHOICE,
  prompt: 'When do you play?',
  required: false,
  options: ['Evenings', 'Weekends'],
};
const RULES: ApplicationQuestion = {
  id: 'rules',
  kind: ApplicationQuestionKind.YES_NO,
  prompt: 'Have you read the rules?',
  required: true,
  options: [],
};
const FORM = [WHY, ABOUT, TIMEZONE, RULES];

/**
 * Runs the check and returns the message it refused with.
 *
 * @param answers - The answers sent.
 * @returns The refusal's message.
 */
function refusal(answers: { questionId: string; value: unknown }[]): string {
  try {
    validateAnswers(FORM, answers);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);

    return (error as BadRequestException).message;
  }

  throw new Error('Expected a refusal');
}

describe('validateAnswers', () => {
  it('keeps trimmed answers in the form’s order, whatever order they came in', () => {
    expect(
      validateAnswers(FORM, [
        { questionId: 'rules', value: true },
        { questionId: 'zone', value: 'Weekends' },
        { questionId: 'why', value: '  Friends are here  ' },
      ]),
    ).toEqual([
      { questionId: 'why', value: 'Friends are here' },
      { questionId: 'zone', value: 'Weekends' },
      { questionId: 'rules', value: true },
    ]);
  });

  it('keeps a no as an answer', () => {
    expect(
      validateAnswers(FORM, [
        { questionId: 'why', value: 'Because' },
        { questionId: 'rules', value: false },
      ]),
    ).toContainEqual({ questionId: 'rules', value: false });
  });

  it('leaves out an optional question left blank, however it was left', () => {
    expect(
      validateAnswers(FORM, [
        { questionId: 'why', value: 'Because' },
        { questionId: 'about', value: '   ' },
        { questionId: 'zone', value: '' },
        { questionId: 'rules', value: true },
      ]),
    ).toEqual([
      { questionId: 'why', value: 'Because' },
      { questionId: 'rules', value: true },
    ]);
    expect(
      validateAnswers(FORM, [
        { questionId: 'why', value: 'Because' },
        { questionId: 'about', value: null },
        { questionId: 'rules', value: true },
      ]),
    ).toHaveLength(2);
  });

  it('asks for a required question left unanswered, by its prompt', () => {
    expect(refusal([{ questionId: 'rules', value: true }])).toBe(
      'Please answer: Why this Fleet?',
    );
    expect(
      refusal([
        { questionId: 'why', value: '  ' },
        { questionId: 'rules', value: true },
      ]),
    ).toBe('Please answer: Why this Fleet?');
  });

  it('refuses an answer to a question the form does not ask', () => {
    expect(refusal([{ questionId: 'ghost', value: 'x' }])).toContain(
      'a question this form does not ask',
    );
  });

  it('refuses a question answered twice', () => {
    expect(
      refusal([
        { questionId: 'why', value: 'One' },
        { questionId: 'why', value: 'Two' },
      ]),
    ).toBe('A question was answered twice.');
  });

  it('refuses a yes or no that is not a boolean', () => {
    expect(
      refusal([
        { questionId: 'why', value: 'Because' },
        { questionId: 'rules', value: 'yes' },
      ]),
    ).toBe('Please answer yes or no: Have you read the rules?');
  });

  it('refuses a choice that is not one of the options, or not text', () => {
    expect(
      refusal([
        { questionId: 'why', value: 'Because' },
        { questionId: 'zone', value: 'Mornings' },
        { questionId: 'rules', value: true },
      ]),
    ).toBe('Please choose one of the options for: When do you play?');
    expect(
      refusal([
        { questionId: 'why', value: 'Because' },
        { questionId: 'zone', value: 3 },
        { questionId: 'rules', value: true },
      ]),
    ).toBe('Please choose one of the options for: When do you play?');
  });

  it('refuses text that is not text, or too long for its kind', () => {
    expect(
      refusal([
        { questionId: 'why', value: 42 },
        { questionId: 'rules', value: true },
      ]),
    ).toBe('Please answer in words: Why this Fleet?');
    expect(
      refusal([
        { questionId: 'why', value: 'x'.repeat(201) },
        { questionId: 'rules', value: true },
      ]),
    ).toBe('That answer is longer than 200 characters: Why this Fleet?');
    expect(
      validateAnswers(FORM, [
        { questionId: 'why', value: 'x'.repeat(200) },
        { questionId: 'about', value: 'y'.repeat(2000) },
        { questionId: 'rules', value: true },
      ]),
    ).toHaveLength(3);
  });
});
