import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { CreateUserReportDto } from './dto/create-user-report.dto';
import { ReportReason } from './enums/report-reason.enum';
import { ModerationController } from './moderation.controller';
import { ReportService } from './report.service';

const USER_ID = 'reporter-1';

describe('ModerationController', () => {
  let controller: ModerationController;
  let reportService: { reportMember: jest.Mock<() => Promise<void>> };

  beforeEach(async () => {
    reportService = {
      reportMember: jest.fn(() => Promise.resolve(undefined)),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModerationController],
      providers: [{ provide: ReportService, useValue: reportService }],
    }).compile();

    controller = module.get<ModerationController>(ModerationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reportMember', () => {
    it('should pass the caller and the report through to the service', async () => {
      const dto: CreateUserReportDto = {
        username: 'reported',
        reason: ReportReason.HARASSMENT,
        details: 'Repeated abusive messages.',
      };

      await controller.reportMember(USER_ID, dto);

      expect(reportService.reportMember).toHaveBeenCalledWith(USER_ID, dto);
    });
  });
});
