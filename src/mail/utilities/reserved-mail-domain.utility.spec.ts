import { reservedMailDomain } from './reserved-mail-domain.utility';

describe('reservedMailDomain', () => {
  it.each([
    ['demo-user-014@example.com', 'example.com'],
    ['someone@mail.example.net', 'mail.example.net'],
    ['someone@EXAMPLE.ORG', 'example.org'],
    ['owner@fc044.example', 'fc044.example'],
    ['nobody@anything.invalid', 'anything.invalid'],
    ['tester@app.test', 'app.test'],
    ['root@localhost', 'localhost'],
    ['trailing@example.com.', 'example.com'],
    ['quoted"@"name@rehearsal.example', 'rehearsal.example'],
  ])('finds %s reserved', (address, domain) => {
    expect(reservedMailDomain(address)).toBe(domain);
  });

  it.each([
    'captain@sto-info.app',
    'someone@gmail.com',
    // Real domains that merely contain the reserved words.
    'someone@example.co.uk',
    'someone@myexample.com',
    'someone@testing.org',
    'someone@invalid.io',
    'not an address',
  ])('leaves %s alone', address => {
    expect(reservedMailDomain(address)).toBeNull();
  });
});
