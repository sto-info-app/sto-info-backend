import { BannerEntity } from './banner.entity';
import { NotificationSeverity } from '../enums/notification-severity.enum';

describe('BannerEntity', () => {
  it('stores assigned banner fields', () => {
    const entity = new BannerEntity();
    entity.message = 'Scheduled maintenance tonight';
    entity.severity = NotificationSeverity.WARNING;
    entity.dismissible = true;

    expect(entity.message).toBe('Scheduled maintenance tonight');
    expect(entity.severity).toBe(NotificationSeverity.WARNING);
    expect(entity.dismissible).toBe(true);
  });
});
