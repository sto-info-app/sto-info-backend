import { ArgumentsHost, HttpStatus } from '@nestjs/common';
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

  it('should handle different MulterError codes', () => {
    const exception = new MulterError('LIMIT_UNEXPECTED_FILE', 'file');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
    expect(mockResponse.json).toHaveBeenCalled();
  });
});
