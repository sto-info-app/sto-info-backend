import { PartialType } from '@nestjs/swagger';
import { CreateNewsPostDto } from './create-news-post.dto';

export class UpdateNewsPostDto extends PartialType(CreateNewsPostDto) {}
