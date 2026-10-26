import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  Activity,
  Comment,
  Idea,
  ItineraryEntry,
  Member,
  Post,
  TransferCode,
  Trip,
  Vote,
} from './entities';
import { SocialModule } from './social/social.module';
import { ActivityModule } from './activity/activity.module';
import { UnfurlModule } from './unfurl/unfurl.module';
import { TripsModule } from './trips/trips.module';
import { IdeasModule } from './ideas/ideas.module';
import { ItineraryModule } from './itinerary/itinerary.module';

export const ENTITIES = [
  Trip,
  Member,
  Idea,
  Vote,
  ItineraryEntry,
  Comment,
  Post,
  Activity,
  TransferCode,
];

function databasePath(): string {
  const p = process.env.DB_PATH ?? join(process.cwd(), 'data', 'letsgo.sqlite');
  if (p !== ':memory:') mkdirSync(dirname(p), { recursive: true });
  return p;
}

/** The built Angular app, when present, is served by the API so one process is the whole deploy. */
const webDist = join(__dirname, '..', '..', 'web', 'dist', 'web', 'browser');

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: databasePath(),
      entities: ENTITIES,
      synchronize: true,
    }),
    ...(existsSync(webDist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDist,
            exclude: ['/api/{*splat}'],
          }),
        ]
      : []),
    ActivityModule,
    TripsModule,
    IdeasModule,
    ItineraryModule,
    SocialModule,
    UnfurlModule,
  ],
})
export class AppModule {}
