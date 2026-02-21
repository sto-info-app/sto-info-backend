import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SecretsService } from './secrets.service';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  GetSecretValueCommand: jest.fn().mockImplementation(args => args),
}));

describe('SecretsService', () => {
  let service: SecretsService;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SecretsService],
    }).compile();

    service = module.get<SecretsService>(SecretsService);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSecret', () => {
    it('should retrieve and cache secret from AWS Secrets Manager', async () => {
      const secretData = { key: 'value', apiToken: 'secret123' };
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify(secretData),
      });

      const result = await service.getSecret('test-secret');

      expect(result).toEqual(secretData);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({ SecretId: 'test-secret' });
    });

    it('should return cached secret on subsequent calls', async () => {
      const secretData = { cachedKey: 'cachedValue' };
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify(secretData),
      });

      // First call - retrieves from AWS
      const result1 = await service.getSecret('cached-secret');
      expect(result1).toEqual(secretData);
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Second call - returns from cache
      const result2 = await service.getSecret('cached-secret');
      expect(result2).toEqual(secretData);
      expect(mockSend).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should handle different secrets independently', async () => {
      const secret1Data = { key1: 'value1' };
      const secret2Data = { key2: 'value2' };

      mockSend
        .mockResolvedValueOnce({ SecretString: JSON.stringify(secret1Data) })
        .mockResolvedValueOnce({ SecretString: JSON.stringify(secret2Data) });

      const result1 = await service.getSecret('secret1');
      const result2 = await service.getSecret('secret2');

      expect(result1).toEqual(secret1Data);
      expect(result2).toEqual(secret2Data);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle AWS SDK errors and log them', async () => {
      const error = new Error('AWS SDK Error');
      (error as any).stack = 'Error stack';
      mockSend.mockRejectedValue(error);

      await expect(service.getSecret('failing-secret')).rejects.toThrow(
        'AWS SDK Error',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to get secret failing-secret',
        'Error stack',
      );
    });

    it('should handle error without stack trace', async () => {
      const error = new Error('No stack error');
      delete error.stack;
      mockSend.mockRejectedValue(error);

      await expect(service.getSecret('no-stack-secret')).rejects.toThrow(
        'No stack error',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to get secret no-stack-secret',
        undefined,
      );
    });

    it('should handle non-Error thrown values and log undefined stack', async () => {
      mockSend.mockRejectedValue('boom');

      await expect(service.getSecret('string-error-secret')).rejects.toBe(
        'boom',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to get secret string-error-secret',
        undefined,
      );
    });

    it('should return undefined if SecretString is not in response', async () => {
      mockSend.mockResolvedValue({}); // No SecretString field

      const result = await service.getSecret('empty-secret');

      expect(result).toBeUndefined();
    });

    it('should return undefined if SecretString is empty', async () => {
      mockSend.mockResolvedValue({ SecretString: '' });

      const result = await service.getSecret('empty-string-secret');

      expect(result).toBeUndefined();
    });

    it('should parse complex JSON secrets correctly', async () => {
      const complexSecret = {
        database: {
          host: 'localhost',
          port: 5432,
        },
        apiKeys: ['key1', 'key2', 'key3'],
        nested: {
          deeply: {
            value: 'test',
          },
        },
      };
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify(complexSecret),
      });

      const result = await service.getSecret('complex-secret');

      expect(result).toEqual(complexSecret);
      expect(result.database.host).toBe('localhost');
      expect(result.apiKeys).toHaveLength(3);
    });
  });
});
