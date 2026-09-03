import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';
import * as fc from 'fast-check';

import { SesWebhookController } from '../../webhooks/ses/ses-webhook.controller';
import { SesWebhookService } from '../../webhooks/ses/ses-webhook.service';

describe('SesWebhookController Fuzz Tests', () => {
  let controller: SesWebhookController;
  let service: jest.Mocked<SesWebhookService>;
  let module: TestingModule;
  const numRuns = Number(process.env['FUZZ_NUM_RUNS']) || 100;

  beforeEach(async () => {
    service = {
      validateTopicArn: jest.fn().mockReturnValue(true),
      confirmSubscription: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
      processNotification: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(undefined),
    } as any;

    module = await Test.createTestingModule({
      controllers: [SesWebhookController],
      providers: [{ provide: SesWebhookService, useValue: service }],
    }).compile();

    controller = module.get<SesWebhookController>(SesWebhookController);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should handle arbitrary bodies and headers without crashing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string(), fc.object(), fc.array(fc.anything())),
        fc.oneof(fc.string(), fc.constant(undefined)),
        async (body, messageType) => {
          try {
            await controller.handleSnsNotification(messageType as string, body);
          } catch (err) {
            // Exceptions like ForbiddenException are expected outcomes of validation, not crashes
            if (!(err instanceof ForbiddenException)) {
              throw err;
            }
          }
        },
      ),
      { numRuns },
    );
  });

  it('should handle deeply nested JSON strings without crashing', async () => {
    // Generate complex objects that can be serialized to JSON
    const objectArb = fc.object({ maxDepth: 10 });

    await fc.assert(
      fc.asyncProperty(objectArb, async obj => {
        const body = JSON.stringify(obj);
        try {
          await controller.handleSnsNotification('Notification', body);
        } catch (err) {
          if (!(err instanceof ForbiddenException)) {
            throw err;
          }
        }
      }),
      { numRuns },
    );
  });
});
