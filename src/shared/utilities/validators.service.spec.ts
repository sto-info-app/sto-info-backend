import { ValidatorsService } from './validators.service';

describe('ValidatorsService', () => {
  let service: ValidatorsService;

  beforeEach(() => {
    service = new ValidatorsService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUuid', () => {
    it('should return true for valid UUIDs', () => {
      const validUuids = [
        '123e4567-e89b-12d3-a456-426614174000',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '00000000-0000-0000-0000-000000000000',
      ];
      validUuids.forEach(uuid => {
        expect(service.validateUuid(uuid)).toBe(true);
      });
    });

    it('should return false for invalid UUIDs', () => {
      const invalidUuids = [
        'not-a-uuid',
        '123',
        '',
        '123e4567-e89b-12d3-a456',
        'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      ];
      invalidUuids.forEach(uuid => {
        expect(service.validateUuid(uuid)).toBe(false);
      });
    });
  });

  describe('validateEmail', () => {
    it('should return true for valid emails', () => {
      const validEmails = [
        'test@example.com',
        'user123@domain.co.uk',
        'first+last@test.org',
        'test_123@example.com',
        'user.name@domain.test',
      ];
      validEmails.forEach(email => {
        expect(service.validateEmail(email)).toBe(true);
      });
    });

    it('should return false for invalid emails', () => {
      const invalidEmails = [
        'invalid',
        '@example.com',
        'test@',
        'test @example.com',
        '',
      ];
      invalidEmails.forEach(email => {
        expect(service.validateEmail(email)).toBe(false);
      });
    });
  });

  describe('validateUsername', () => {
    it('should return true for valid usernames (alphanumeric, 5-50 chars)', () => {
      const validUsernames = [
        'user123',
        'johndoe',
        'testuser',
        'User123ABC',
        'abcde',
      ];
      validUsernames.forEach(username => {
        expect(service.validateUsername(username)).toBe(true);
      });
    });

    it('should return false for invalid usernames', () => {
      const invalidUsernames = [
        'usr', // too short (< 5 chars)
        'u', // too short
        '',
        'user_name', // underscore not allowed
        'user-name', // hyphen not allowed
        'user with spaces',
        'user@domain',
        'user!',
      ];
      invalidUsernames.forEach(username => {
        expect(service.validateUsername(username)).toBe(false);
      });
    });
  });

  describe('validatePassword', () => {
    it('should return true for valid passwords (8+ chars, upper, lower, number, special)', () => {
      const validPasswords = [
        'Password123!',
        'MyP@ssw0rd',
        'Str0ng!Pass',
        'Test1234!@#',
      ];
      validPasswords.forEach(password => {
        expect(service.validatePassword(password)).toBe(true);
      });
    });

    it('should return false for invalid passwords', () => {
      const invalidPasswords = [
        'weak', // too short
        'Short1!', // too short (< 8 chars)
        'NoSpecialChar1', // missing special char
        'nouppercasechar1!', // missing uppercase
        'NOLOWERCASECHAR1!', // missing lowercase
        'NoNumbers!', // missing number
      ];
      invalidPasswords.forEach(password => {
        expect(service.validatePassword(password)).toBe(false);
      });
    });
  });
});
