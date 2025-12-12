import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch(MulterError)
export class FileSizeExceptionFilter implements ExceptionFilter {
  catch(_exception: MulterError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = HttpStatus.PAYLOAD_TOO_LARGE;

    response.status(status).json({
      statusCode: status,
      message:
        'File size is too large. Maximum allowed size is ' +
        process.env.MAX_IMAGE_SIZE_IN_BYTES +
        ' bytes.',
      error: 'Payload Too Large',
    });
  }
}
