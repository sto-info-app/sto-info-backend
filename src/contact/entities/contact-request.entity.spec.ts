import { ContactRequestEntity } from './contact-request.entity';

describe('ContactRequestEntity', () => {
  it('should be defined', () => {
    const entity = new ContactRequestEntity();
    expect(entity).toBeDefined();
  });
});
