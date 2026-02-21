import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch(MulterError)
export class FileSizeExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = HttpStatus.PAYLOAD_TOO_LARGE;

    let message: string;
    if (exception.code === 'LIMIT_FILE_SIZE') {
      message = `File size is too large. Maximum allowed size is ${process.env.MAX_IMAGE_SIZE_IN_BYTES} bytes.`;
    } else if (exception.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded. Only 1 file is allowed.';
    } else if (exception.code === 'LIMIT_FIELD_COUNT') {
      message = 'Too many fields uploaded.';
    } else if (exception.code === 'LIMIT_FIELD_VALUE') {
      message = `Field content is too large. Maximum allowed size is ${process.env.MAX_IMAGE_SIZE_IN_BYTES} bytes.`;
    } else {
      message = `Upload failed: ${exception.message || exception.code}`;
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: 'Payload Too Large',
    });
  }
}
