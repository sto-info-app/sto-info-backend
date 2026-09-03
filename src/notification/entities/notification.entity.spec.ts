import { NotificationSeverity } from '../enums/notification-severity.enum';
import { NotificationTarget } from '../enums/notification-target.enum';
import { NotificationEntity } from './notification.entity';

describe('NotificationEntity', () => {
  it('stores assigned notification fields', () => {
    const entity = new NotificationEntity();
    entity.target = NotificationTarget.USER;
    entity.severity = NotificationSeverity.INFO;
    entity.title = 'Welcome';
    entity.body = 'Your account is ready.';

    expect(entity.target).toBe(NotificationTarget.USER);
    expect(entity.severity).toBe(NotificationSeverity.INFO);
    expect(entity.title).toBe('Welcome');
    expect(entity.body).toBe('Your account is ready.');
  });
});
