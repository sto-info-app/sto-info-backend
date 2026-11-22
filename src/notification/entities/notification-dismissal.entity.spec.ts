import { NotificationDismissalEntity } from './notification-dismissal.entity';

describe('NotificationDismissalEntity', () => {
  it('stores which notification which user deleted from their inbox', () => {
    const entity = new NotificationDismissalEntity();
    entity.notificationId = '11111111-1111-1111-1111-111111111111';
    entity.userId = '22222222-2222-2222-2222-222222222222';

    expect(entity.notificationId).toBe('11111111-1111-1111-1111-111111111111');
    expect(entity.userId).toBe('22222222-2222-2222-2222-222222222222');
  });
});
