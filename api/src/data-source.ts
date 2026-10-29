import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database/database.config';

/** Used by the TypeORM CLI to generate and run migrations. */
export default new DataSource({ ...databaseOptions(), migrationsRun: false });
