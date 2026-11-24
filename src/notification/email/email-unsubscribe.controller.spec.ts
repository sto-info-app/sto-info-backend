import { BadRequestException } from '@nestjs/common';

import { UserPreferenceService } from 'src/user/user-preference.service';

import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';
import { NotificationEmailType } from './notification-email-type.enum';

describe('EmailUnsubscribeController (sc-1067)', () => {
  const claim = {
    userId: 'user-1',
    types: [
      NotificationEmailType.STORYTIME_COMMENT,
      NotificationEmailType.FRIEND_REQUEST,
    ],
  };
  let tokens: { verify: jest.Mock };
  let preferences: { update: jest.Mock };
  let controller: EmailUnsubscribeController;

  beforeEach(() => {
    tokens = {
      verify: jest.fn((token: string) => (token === 'good' ? claim : null)),
    };
    preferences = { update: jest.fn(async () => ({})) };
    controller = new EmailUnsubscribeController(
      tokens as unknown as EmailUnsubscribeTokenService,
      preferences as unknown as UserPreferenceService,
    );
  });

  const described = {
    types: [
      {
        type: NotificationEmailType.STORYTIME_COMMENT,
        label: 'Comments on my work',
      },
      { type: NotificationEmailType.FRIEND_REQUEST, label: 'Friend requests' },
    ],
  };

  // A mail scanner following the link must not unsubscribe anybody.
  it('says what a link turns off without changing anything', () => {
    expect(controller.preview('good')).toEqual(described);
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('turns off each email the link names, and no other', async () => {
    await expect(controller.unsubscribe('good')).resolves.toEqual(described);
    expect(preferences.update).toHaveBeenCalledWith('user-1', {
      emailNotifications: {
        [NotificationEmailType.STORYTIME_COMMENT]: false,
        [NotificationEmailType.FRIEND_REQUEST]: false,
      },
    });
  });

  it('refuses a link it did not sign', async () => {
    expect(() => controller.preview('bad')).toThrow(BadRequestException);
    await expect(controller.unsubscribe('bad')).rejects.toThrow(
      'That unsubscribe link is not valid.',
    );
    expect(preferences.update).not.toHaveBeenCalled();
  });
});
