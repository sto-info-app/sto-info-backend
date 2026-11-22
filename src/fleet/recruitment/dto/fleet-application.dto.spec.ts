import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SubmitFleetApplicationDto } from './fleet-application.dto';

/** A Character the applicant owns. */
const CHARACTER_ID = '8b5f4c3d-0e6a-4b7c-9d8e-9f0a1b2c3d4e';

/**
 * Validates an application as the global pipe does: undeclared properties
 * refused, so a property with no decorator refuses every request carrying
 * it. That is how every answer was once refused.
 *
 * @param answers - The answers sent.
 * @returns The messages, flattened through the nested answers.
 */
async function problems(answers: unknown[]): Promise<string[]> {
  const errors = await validate(
    plainToInstance(SubmitFleetApplicationDto, {
      characterId: CHARACTER_ID,
      settingsVersion: 1,
      answers,
    }),
    { whitelist: true, forbidNonWhitelisted: true },
  );

  return errors.flatMap(error =>
    (error.children ?? []).flatMap(answer =>
      (answer.children ?? []).flatMap(field =>
        Object.values(field.constraints ?? {}),
      ),
    ),
  );
}

describe('SubmitFleetApplicationDto', () => {
  it('takes text and yes-or-no answers', async () => {
    await expect(
      problems([
        { questionId: 'q-handle', value: '@fixture002' },
        { questionId: 'q-why', value: 'x'.repeat(2000) },
        { questionId: 'q-rules', value: true },
        { questionId: 'q-other', value: false },
      ]),
    ).resolves.toEqual([]);
  });

  it.each([
    ['a number', 7],
    ['nothing', null],
    ['a list', ['Weekends']],
    ['text longer than any answer may be', 'x'.repeat(2001)],
  ])('refuses %s as an answer', async (_case, value) => {
    await expect(problems([{ questionId: 'q-why', value }])).resolves.toEqual([
      'An answer is text of at most 2000 characters, or yes or no.',
    ]);
  });
});
