import { Test, TestingModule } from '@nestjs/testing';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

describe('ContactController', () => {
  let controller: ContactController;
  let contactService: ContactService;

  beforeEach(async () => {
    const submitContactRequestMock: jest.MockedFunction<
      ContactService['submitContactRequest']
    > = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [
        {
          provide: ContactService,
          useValue: {
            submitContactRequest: submitContactRequestMock,
          },
        },
      ],
    }).compile();

    controller = module.get<ContactController>(ContactController);
    contactService = module.get<ContactService>(ContactService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('submitContact', () => {
    it('should forward the contact request', async () => {
      const payload = {
        name: 'name',
        email: 'email@example.com',
        topic: 'other',
        message: 'This is the message!',
      };

      await controller.submitContact(payload);

      expect(contactService.submitContactRequest).toHaveBeenCalledWith(payload);
    });
  });
});
