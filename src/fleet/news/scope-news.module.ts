import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetIngressModule } from 'src/file-assets/asset-ingress.module';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { RegistryModule } from 'src/registry/registry.module';

import { FleetModule } from '../fleet.module';
import { AdminScopeNewsController } from './admin-scope-news.controller';
import {
  ArmadaNewsController,
  CommunityNewsController,
  FleetNewsController,
} from './scope-news.controllers';
import { ScopeNewsCoverPublisher } from './services/scope-news-cover.publisher';
import { ScopeNewsService } from './services/scope-news.service';

/**
 * A Community's, a Fleet's and an Armada's news (FC-027), kept in the site's
 * own news table.
 */
@Module({
  imports: [
    FleetModule,
    AssetIngressModule,
    RegistryModule,
    TypeOrmModule.forFeature([NewsPostEntity]),
  ],
  controllers: [
    CommunityNewsController,
    FleetNewsController,
    ArmadaNewsController,
    AdminScopeNewsController,
  ],
  providers: [ScopeNewsService, ScopeNewsCoverPublisher],
  exports: [ScopeNewsService],
})
export class ScopeNewsModule {}
