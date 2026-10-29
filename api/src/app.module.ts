import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { join } from 'path';
import { databaseOptions } from './database/database.config';
import { LegacyImportModule } from './database/legacy-import.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { SocialModule } from './social/social.module';
import { ActivityModule } from './activity/activity.module';
import { UnfurlModule } from './unfurl/unfurl.module';
import { PhotosModule } from './photos/photos.module';
import { AiModule } from './ai/ai.module';
import { AdminModule } from './admin/admin.module';
import { TripsModule } from './trips/trips.module';
import { IdeasModule } from './ideas/ideas.module';
import { ItineraryModule } from './itinerary/itinerary.module';

export { ENTITIES } from './entities';

/** The built Angular app, when present, is served by the API so one process is the whole deploy. */
const webDist = join(__dirname, '..', '..', 'web', 'dist', 'web', 'browser');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: () => databaseOptions() }),
    LegacyImportModule,
    ...(existsSync(webDist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDist,
            exclude: ['/api/{*splat}'],
            serveStaticOptions: {
              // The service worker's manifest must always be revalidated or updates never land.
              setHeaders: (res: import('express').Response, path: string) => {
                if (
                  /ngsw\.json$|ngsw-worker\.js$|index\.html$|manifest\.webmanifest$/.test(
                    path,
                  )
                ) {
                  res.setHeader('Cache-Control', 'no-cache');
                }
              },
            },
          }),
        ]
      : []),
    ActivityModule,
    AuthModule,
    TripsModule,
    IdeasModule,
    ItineraryModule,
    SocialModule,
    UnfurlModule,
    PhotosModule,
    AiModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
