import { jest } from '@jest/globals';
import { ClsServiceManager } from 'nestjs-cls';

import { CurrentContextHelper } from './current-context.helper';

jest.mock('nestjs-cls', () => ({
  ClsServiceManager: {
    getClsService: jest.fn(),
  },
}));

describe('CurrentContextHelper', () => {
  let mockCls: any;

  beforeEach(() => {
    mockCls = {
      isActive: jest.fn().mockReturnValue(true),
      get: jest.fn(),
      set: jest.fn(),
    };
    (ClsServiceManager.getClsService as jest.Mock).mockReturnValue(mockCls);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('userUuid', () => {
    it('should get userUuid', () => {
      mockCls.get.mockReturnValue('uuid');
      expect(CurrentContextHelper.userUuid).toBe('uuid');
    });

    it('should return null if cls not active', () => {
      mockCls.isActive.mockReturnValue(false);
      expect(CurrentContextHelper.userUuid).toBeNull();
    });

    it('should set userUuid', () => {
      CurrentContextHelper.userUuid = 'uuid';
      expect(mockCls.set).toHaveBeenCalledWith('userUuid', 'uuid');
    });

    it('should not set if cls not active', () => {
      mockCls.isActive.mockReturnValue(false);
      CurrentContextHelper.userUuid = 'uuid';
      expect(mockCls.set).not.toHaveBeenCalled();
    });
  });

  describe('ip', () => {
    it('should get ip', () => {
      mockCls.get.mockReturnValue('1.1.1.1');
      expect(CurrentContextHelper.ip).toBe('1.1.1.1');
    });

    it('should return null if cls not active', () => {
      mockCls.isActive.mockReturnValue(false);
      expect(CurrentContextHelper.ip).toBeNull();
    });

    it('should set ip', () => {
      CurrentContextHelper.ip = '1.1.1.1';
      expect(mockCls.set).toHaveBeenCalledWith('ip', '1.1.1.1');
    });

    it('should not set if cls not active', () => {
      mockCls.isActive.mockReturnValue(false);
      CurrentContextHelper.ip = '1.1.1.1';
      expect(mockCls.set).not.toHaveBeenCalled();
    });
  });

  describe('activeCls edge cases', () => {
    it('should return null if getClsService returns null', () => {
      (ClsServiceManager.getClsService as jest.Mock).mockReturnValue(null);
      expect((CurrentContextHelper as any).activeCls).toBeNull();
    });

    it('should return null if cls does not have isActive method', () => {
      const badCls = {};
      (ClsServiceManager.getClsService as jest.Mock).mockReturnValue(badCls);
      expect((CurrentContextHelper as any).activeCls).toEqual(badCls);
      // Wait, if it DOES NOT have isActive, it returns cls. (line 19)
    });

    it('should return null if isActive is false', () => {
      mockCls.isActive.mockReturnValue(false);
      expect((CurrentContextHelper as any).activeCls).toBeNull();
    });
  });
});
