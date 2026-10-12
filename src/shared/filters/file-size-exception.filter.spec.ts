import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { jest } from '@jest/globals';
import { MulterError } from 'multer';

import { FileSizeExceptionFilter } from './file-size-exception.filter';

describe('FileSizeExceptionFilter', () => {
  let filter: FileSizeExceptionFilter;
  let mockArgumentsHost: ArgumentsHost;
  let mockResponse: any;
  let mockCtx: any;

  beforeEach(() => {
    filter = new FileSizeExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockCtx = {
      getResponse: jest.fn().mockReturnValue(mockResponse),
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue(mockCtx),
    } as any;

    process.env.MAX_IMAGE_SIZE_IN_BYTES = '5242880';
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should catch MulterError and return PAYLOAD_TOO_LARGE status', () => {
    const exception = new MulterError('LIMIT_FILE_SIZE', 'file');

    filter.catch(exception, mockArgumentsHost);

    expect(mockArgumentsHost.switchToHttp).toHaveBeenCalled();
    expect(mockCtx.getResponse).toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  });

  it('should return correct error message with max file size from env', () => {
    const exception = new MulterError('LIMIT_FILE_SIZE', 'file');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'File size is too large. Maximum allowed size is 5242880 bytes.',
      error: 'Payload Too Large',
    });
  });

  describe('handle different MulterError codes', () => {
    const testCases = [
      {
        code: 'LIMIT_FILE_SIZE' as const,
        expectedMessage:
          'File size is too large. Maximum allowed size is 5242880 bytes.',
        expectedStatus: HttpStatus.PAYLOAD_TOO_LARGE,
        expectedError: 'Payload Too Large',
      },
      {
        code: 'LIMIT_FILE_COUNT' as const,
        expectedMessage: 'Too many files uploaded. Only 1 file is allowed.',
        expectedStatus: HttpStatus.PAYLOAD_TOO_LARGE,
        expectedError: 'Payload Too Large',
      },
      {
        code: 'LIMIT_FIELD_COUNT' as const,
        expectedMessage: 'Too many fields uploaded.',
        expectedStatus: HttpStatus.PAYLOAD_TOO_LARGE,
        expectedError: 'Payload Too Large',
      },
      {
        code: 'LIMIT_FIELD_VALUE' as const,
        expectedMessage:
          'Field content is too large. Maximum allowed size is 5242880 bytes.',
        expectedStatus: HttpStatus.PAYLOAD_TOO_LARGE,
        expectedError: 'Payload Too Large',
      },
      {
        code: 'LIMIT_UNEXPECTED_FILE' as const,
        expectedMessage: 'Unexpected file field in upload.',
        expectedStatus: HttpStatus.BAD_REQUEST,
        expectedError: 'Bad Request',
      },
    ];

    it.each(testCases)(
      'should return correct message for $code',
      ({ code, expectedMessage, expectedStatus, expectedError }) => {
        const exception = new MulterError(code);
        // MulterError message is set based on the code in the constructor
        // but we can override it if needed for the test.

        filter.catch(exception, mockArgumentsHost);

        expect(mockResponse.status).toHaveBeenCalledWith(expectedStatus);
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: expectedStatus,
          message: expectedMessage,
          error: expectedError,
        });
      },
    );

    it('should not track Multer wording for LIMIT_UNEXPECTED_FILE', () => {
      const exception = new MulterError('LIMIT_UNEXPECTED_FILE');
      // Multer renamed this message between 2.3.0 and 2.4.0; the response must
      // stay the same whichever wording the installed version supplies.
      exception.message = 'Unexpected field';

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Unexpected file field in upload.',
        error: 'Bad Request',
      });
    });

    it('should use exception.code if message is missing in default case', () => {
      const exception = new MulterError('LIMIT_PART_COUNT');
      exception.message = undefined as any;
      filter.catch(exception, mockArgumentsHost);
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Upload failed: LIMIT_PART_COUNT',
        error: 'Bad Request',
      });
    });
  });
});
