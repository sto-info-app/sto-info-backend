import { BannerEntity } from './banner.entity';
import { NotificationSeverity } from '../enums/notification-severity.enum';

describe('BannerEntity', () => {
  it('stores assigned banner fields', () => {
    const entity = new BannerEntity();
    entity.message = 'Scheduled maintenance tonight';
    entity.severity = NotificationSeverity.WARN;
    entity.dismissible = true;

    expect(entity.message).toBe('Scheduled maintenance tonight');
    expect(entity.severity).toBe(NotificationSeverity.WARN);
    expect(entity.dismissible).toBe(true);
  });
});
