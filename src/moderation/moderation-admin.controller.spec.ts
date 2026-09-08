import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { ModeratedUserDto } from './dto/moderated-user.dto';
import { PaginatedReportsDto, UserReportDto } from './dto/user-report.dto';
import { ReportStatus } from './enums/report-status.enum';
import { ModerationAdminController } from './moderation-admin.controller';
import { ReportService } from './report.service';
import { UserModerationService } from './user-moderation.service';

const ADMIN_ID = 'admin-1';
const REPORT_ID = 'report-1';
const MEMBER_ID = 'member-1';

describe('ModerationAdminController', () => {
  let controller: ModerationAdminController;
  let reportService: {
    findForAdmin: jest.Mock<() => Promise<PaginatedReportsDto>>;
    findOneForAdmin: jest.Mock<() => Promise<UserReportDto>>;
    updateForAdmin: jest.Mock<() => Promise<UserReportDto>>;
  };
  let userModerationService: {
    findUsers: jest.Mock;
    findUser: jest.Mock<() => Promise<ModeratedUserDto>>;
    disableUser: jest.Mock<() => Promise<ModeratedUserDto>>;
    enableUser: jest.Mock<() => Promise<ModeratedUserDto>>;
  };

  beforeEach(async () => {
    const report = { id: REPORT_ID } as UserReportDto;
    const member = { id: MEMBER_ID } as ModeratedUserDto;

    reportService = {
      findForAdmin: jest.fn(() =>
        Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          openCount: 0,
        }),
      ),
      findOneForAdmin: jest.fn(() => Promise.resolve(report)),
      updateForAdmin: jest.fn(() => Promise.resolve(report)),
    };
    userModerationService = {
      findUsers: jest.fn(() =>
        Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
      ),
      findUser: jest.fn(() => Promise.resolve(member)),
      disableUser: jest.fn(() => Promise.resolve(member)),
      enableUser: jest.fn(() => Promise.resolve(member)),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModerationAdminController],
      providers: [
        { provide: ReportService, useValue: reportService },
        { provide: UserModerationService, useValue: userModerationService },
      ],
    }).compile();

    controller = module.get<ModerationAdminController>(
      ModerationAdminController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reports', () => {
    it('should pass the queue filter through to the service', async () => {
      const query = { status: ReportStatus.OPEN };

      await controller.findReports(query);

      expect(reportService.findForAdmin).toHaveBeenCalledWith(query);
    });

    it('should fetch a single report by ID', async () => {
      await controller.findReport(REPORT_ID);

      expect(reportService.findOneForAdmin).toHaveBeenCalledWith(REPORT_ID);
    });

    it('should pass the acting administrator with the decision', async () => {
      const dto = { status: ReportStatus.DISMISSED };

      await controller.updateReport(ADMIN_ID, REPORT_ID, dto);

      expect(reportService.updateForAdmin).toHaveBeenCalledWith(
        REPORT_ID,
        ADMIN_ID,
        dto,
      );
    });
  });

  describe('members', () => {
    it('should pass the member filter through to the service', async () => {
      const query = { search: 'picard' };

      await controller.findUsers(query);

      expect(userModerationService.findUsers).toHaveBeenCalledWith(query);
    });

    it('should fetch a single member by ID', async () => {
      await controller.findUser(MEMBER_ID);

      expect(userModerationService.findUser).toHaveBeenCalledWith(MEMBER_ID);
    });

    it('should pass the acting administrator when disabling', async () => {
      const dto = { reason: 'Spamming' };

      await controller.disableUser(ADMIN_ID, MEMBER_ID, dto);

      expect(userModerationService.disableUser).toHaveBeenCalledWith(
        MEMBER_ID,
        ADMIN_ID,
        dto,
      );
    });

    it('should pass the acting administrator when restoring', async () => {
      await controller.enableUser(ADMIN_ID, MEMBER_ID);

      expect(userModerationService.enableUser).toHaveBeenCalledWith(
        MEMBER_ID,
        ADMIN_ID,
      );
    });
  });
});
