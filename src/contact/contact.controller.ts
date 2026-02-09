import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/auth/public.decorator';
import { ContactRequestDto } from './dto/contact-request.dto';
import { ContactService } from './contact.service';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /**
   * Submit a contact request and send it to the support inbox.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Submit a contact request' })
  @ApiBody({ type: ContactRequestDto })
  @ApiNoContentResponse({
    description: 'The contact request has been sent.',
  })
  async submitContact(@Body() payload: ContactRequestDto): Promise<void> {
    await this.contactService.submitContactRequest(payload);
  }
}
