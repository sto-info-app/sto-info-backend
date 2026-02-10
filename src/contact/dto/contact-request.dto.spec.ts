import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContactRequestDto } from './contact-request.dto';

describe('ContactRequestDto', () => {
  it('should accept a valid payload', async () => {
    const payload = plainToInstance(ContactRequestDto, {
      name: 'name',
      email: 'email@example.com',
      topic: 'other',
      message: 'This is the message!',
    });

    const errors = await validate(payload);
    expect(errors).toHaveLength(0);
  });

  it('should reject an invalid email', async () => {
    const payload = plainToInstance(ContactRequestDto, {
      name: 'name',
      email: 'not-an-email',
      topic: 'other',
      message: 'This is the message!',
    });

    const errors = await validate(payload);
    expect(errors).not.toHaveLength(0);
  });

  it('should reject missing fields', async () => {
    const payload = plainToInstance(ContactRequestDto, {});

    const errors = await validate(payload);
    expect(errors).not.toHaveLength(0);
  });
});
