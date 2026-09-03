import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NotificationTarget } from '../enums/notification-target.enum';
import { CreateNotificationDto } from './create-notification.dto';

describe('CreateNotificationDto', () => {
  it('accepts a broadcast without a userId', async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      title: 'Hello',
      body: 'World',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('requires a userId when target is USER', async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      target: NotificationTarget.USER,
      title: 'Hello',
      body: 'World',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts a user-targeted notification with a valid userId', async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      target: NotificationTarget.USER,
      userId: '3f0e2d5a-1c2b-4a6d-9e8f-0a1b2c3d4e5f',
      title: 'Hello',
      body: 'World',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects missing title and body', async () => {
    const dto = plainToInstance(CreateNotificationDto, {});
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
