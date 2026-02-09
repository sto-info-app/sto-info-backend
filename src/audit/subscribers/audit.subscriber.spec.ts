import { validateOrReject } from 'class-validator';
import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import {
  EntityManager,
  InsertEvent,
  RemoveEvent,
  Repository,
  UpdateEvent,
} from 'typeorm';
import { AuditLoginAttemptEntity } from '../entities/audit-login-attempt.entity';
import { AuditEntity } from '../entities/audit.entity';
import { AuditSubscriber } from './audit.subscriber';

// Mock class-validator to avoid decorator issues
jest.mock('class-validator', () => ({
  validateOrReject: jest.fn().mockResolvedValue(undefined),
  IsNotEmpty: () => () => {},
  IsString: () => () => {},
  IsOptional: () => () => {},
  IsUUID: () => () => {},
  IsEmail: () => () => {},
  MinLength: () => () => {},
  MaxLength: () => () => {},
  IsBoolean: () => () => {},
  IsDate: () => () => {},
  IsDateString: () => () => {},
  IsInt: () => () => {},
  IsNumber: () => () => {},
  Min: () => () => {},
  Max: () => () => {},
  IsIn: () => () => {},
  IsEnum: () => () => {},
  ValidateNested: () => () => {},
  Type: () => () => {},
  IsArray: () => () => {},
  Length: () => () => {},
  Matches: () => () => {},
  IsJSON: () => () => {},
  IsIP: () => () => {},
  Validate: () => () => {},
}));

describe('AuditSubscriber', () => {
  let subscriber: AuditSubscriber;
  let mockManager: Partial<EntityManager>;
  let mockRepository: Partial<Repository<AuditEntity>>;
  let getUserUuidSpy: jest.SpyInstance;
  let getIpSpy: jest.SpyInstance;

  beforeEach(() => {
    subscriber = new AuditSubscriber();
    mockRepository = {
      save: jest.fn(),
    };
    mockManager = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
    };

    getUserUuidSpy = jest
      .spyOn(CurrentContextHelper, 'userUuid', 'get')
      .mockReturnValue('user-123');
    getIpSpy = jest
      .spyOn(CurrentContextHelper, 'ip', 'get')
      .mockReturnValue('192.168.1.1');
    (validateOrReject as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    getUserUuidSpy.mockRestore();
    getIpSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(subscriber).toBeDefined();
  });

  describe('listenTo', () => {
    it('should listen to all entities', () => {
      expect(subscriber.listenTo()).toBe(Object);
    });
  });

  describe('afterInsert', () => {
    it('should create audit log for INSERT event', async () => {
      const event: Partial<InsertEvent<any>> = {
        entity: { id: '1', name: 'Test' },
        metadata: {
          target: class TestEntity {},
          name: 'TestEntity',
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue('1'),
            },
          ],
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterInsert(event as InsertEvent<any>);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'TestEntity',
          action: 'INSERT',
          entityId: '1',
          userId: 'user-123',
          ipAddress: '192.168.1.1',
        }),
      );
    });

    it('should not audit excluded entities', async () => {
      const event: Partial<InsertEvent<any>> = {
        entity: { id: '1' },
        metadata: {
          target: AuditEntity,
          name: 'AuditEntity',
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterInsert(event as InsertEvent<any>);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should not audit AuditLoginAttemptEntity', async () => {
      const event: Partial<InsertEvent<any>> = {
        entity: { id: '1' },
        metadata: {
          target: AuditLoginAttemptEntity,
          name: 'AuditLoginAttemptEntity',
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterInsert(event as InsertEvent<any>);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should not audit UserRefreshTokenEntity', async () => {
      const event: Partial<InsertEvent<any>> = {
        entity: { id: '1' },
        metadata: {
          target: UserRefreshTokenEntity,
          name: 'UserRefreshTokenEntity',
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterInsert(event as InsertEvent<any>);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('afterUpdate', () => {
    it('should create audit log for UPDATE event with old values', async () => {
      const event: Partial<UpdateEvent<any>> = {
        entity: { id: '1', name: 'Updated' },
        databaseEntity: { id: '1', name: 'Original' },
        metadata: {
          target: class TestEntity {},
          name: 'TestEntity',
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue('1'),
            },
          ],
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterUpdate(event as UpdateEvent<any>);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'TestEntity',
          action: 'UPDATE',
          entityId: '1',
          oldValue: { id: '1', name: 'Original' },
          newValue: { id: '1', name: 'Updated' },
        }),
      );
    });

    it('should handle UPDATE without database entity', async () => {
      const event: Partial<UpdateEvent<any>> = {
        entity: { id: '1', name: 'Updated' },
        metadata: {
          target: class TestEntity {},
          name: 'TestEntity',
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue('1'),
            },
          ],
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterUpdate(event as UpdateEvent<any>);

      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should skip UPDATE when entityId is missing', async () => {
      const event: Partial<UpdateEvent<any>> = {
        entity: { name: 'Updated' },
        metadata: {
          target: class TestEntity {},
          name: 'TestEntity',
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue(null),
            },
          ],
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterUpdate(event as UpdateEvent<any>);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('afterRemove', () => {
    it('should create audit log for REMOVE event', async () => {
      const event: Partial<RemoveEvent<any>> = {
        entity: { id: '1', name: 'Deleted' },
        databaseEntity: { id: '1', name: 'Deleted' },
        metadata: {
          target: class TestEntity {},
          name: 'TestEntity',
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue('1'),
            },
          ],
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterRemove(event as RemoveEvent<any>);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'TestEntity',
          action: 'REMOVE',
          entityId: '1',
        }),
      );
    });
  });

  describe('getEntityId', () => {
    it('should return entity ID as string', () => {
      const event: any = {
        entity: { id: 123 },
        metadata: {
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue(123),
            },
          ],
        },
      };

      const result = (subscriber as any).getEntityId(event);

      expect(result).toBe('123');
    });

    it('should return null if entity ID is not available', () => {
      const event: any = {
        entity: {},
        metadata: {
          primaryColumns: [
            {
              getEntityValue: jest.fn().mockReturnValue(null),
            },
          ],
        },
      };

      const result = (subscriber as any).getEntityId(event);

      expect(result).toBeNull();
    });
  });

  describe('getEntityData', () => {
    it('should return old data from databaseEntity', () => {
      const event: any = {
        databaseEntity: { id: '1', name: 'Old' },
        entity: { id: '1', name: 'New' },
      };

      const result = (subscriber as any).getEntityData(event, 'old');

      expect(result).toEqual({ id: '1', name: 'Old' });
    });

    it('should return null for old data if databaseEntity is null', () => {
      const event: any = {
        databaseEntity: null,
        entity: { id: '1' },
      };

      const result = (subscriber as any).getEntityData(event, 'old');

      expect(result).toBeNull();
    });

    it('should return null for old data if databaseEntity not in event', () => {
      const event: any = {
        entity: { id: '1' },
      };

      const result = (subscriber as any).getEntityData(event, 'old');

      expect(result).toBeNull();
    });

    it('should return new data from entity', () => {
      const event: any = {
        entity: { id: '1', name: 'New' },
      };

      const result = (subscriber as any).getEntityData(event, 'new');

      expect(result).toEqual({ id: '1', name: 'New' });
    });

    it('should return null for new data if entity is null', () => {
      const event: any = {
        entity: null,
      };

      const result = (subscriber as any).getEntityData(event, 'new');

      expect(result).toBeNull();
    });
  });

  describe('createAudit validation', () => {
    it('should call validateOrReject before saving', async () => {
      const event: Partial<InsertEvent<any>> = {
        entity: { id: '1' },
        metadata: {
          target: class TestEntity {},
          name: 'TestEntity',
          primaryColumns: [{ getEntityValue: jest.fn().mockReturnValue('1') }],
        } as any,
        manager: mockManager as EntityManager,
      };

      await subscriber.afterInsert(event as InsertEvent<any>);

      expect(validateOrReject).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
    });
  });
});
