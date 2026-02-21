import type { Request } from 'express';
import { getClientIp } from './client-ip.utility';

describe('client-ip.utility', () => {
  describe('getClientIp', () => {
    let mockReq: Partial<Request>;

    beforeEach(() => {
      mockReq = {
        header: jest.fn(),
      };
      Object.defineProperty(mockReq, 'ip', {
        value: '127.0.0.1',
        writable: true,
        configurable: true,
      });
    });

    it('should return Cloudflare IP when cf-connecting-ip header is present', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return '203.0.113.42';
        return undefined;
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('203.0.113.42');
    });

    it('should normalize IPv6-mapped IPv4 from Cloudflare header', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return '::ffff:192.168.1.1';
        return undefined;
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('192.168.1.1');
    });

    it('should return X-Forwarded-For IP when cf-connecting-ip is not present', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return undefined;
        if (name === 'x-forwarded-for') return '198.51.100.10, 203.0.113.5';
        return undefined;
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('198.51.100.10');
    });

    it('should handle single IP in X-Forwarded-For', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return undefined;
        if (name === 'x-forwarded-for') return '198.51.100.10';
        return undefined;
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('198.51.100.10');
    });

    it('should normalize IPv6-mapped IPv4 from X-Forwarded-For', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return undefined;
        if (name === 'x-forwarded-for') return '::ffff:10.0.0.1';
        return undefined;
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('10.0.0.1');
    });

    it('should fall back to req.ip when no headers are present', () => {
      (mockReq.header as jest.Mock).mockReturnValue(undefined);
      Object.defineProperty(mockReq, 'ip', {
        value: '172.16.0.1',
        writable: true,
        configurable: true,
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('172.16.0.1');
    });

    it('should fall back to empty string when req.ip is undefined', () => {
      (mockReq.header as jest.Mock).mockReturnValue(undefined);
      Object.defineProperty(mockReq, 'ip', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('');
    });

    it('should normalize IPv6-mapped IPv4 from req.ip', () => {
      (mockReq.header as jest.Mock).mockReturnValue(undefined);
      Object.defineProperty(mockReq, 'ip', {
        value: '::ffff:192.168.100.5',
        writable: true,
        configurable: true,
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('192.168.100.5');
    });

    it('should ignore empty cf-connecting-ip header', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return '  ';
        if (name === 'x-forwarded-for') return '198.51.100.20';
        return undefined;
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('198.51.100.20');
    });

    it('should ignore empty x-forwarded-for header', () => {
      (mockReq.header as jest.Mock).mockImplementation((name: string) => {
        if (name === 'cf-connecting-ip') return undefined;
        if (name === 'x-forwarded-for') return '  ';
        return undefined;
      });
      Object.defineProperty(mockReq, 'ip', {
        value: '10.10.10.10',
        writable: true,
        configurable: true,
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('10.10.10.10');
    });

    it('should return IPv6 address unchanged when not IPv4-mapped', () => {
      (mockReq.header as jest.Mock).mockReturnValue(undefined);
      Object.defineProperty(mockReq, 'ip', {
        value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        writable: true,
        configurable: true,
      });

      const result = getClientIp(mockReq as Request);
      expect(result).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });
  });
});
