import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';

import { NewsPostEntity } from './entities/news-post.entity';
import { NewsCoverPublisher } from './news-cover.publisher';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Module({
  imports: [AssetIngressModule, TypeOrmModule.forFeature([NewsPostEntity])],
  controllers: [NewsController],
  providers: [NewsService, NewsCoverPublisher],
  exports: [NewsService],
})
export class NewsModule {}
