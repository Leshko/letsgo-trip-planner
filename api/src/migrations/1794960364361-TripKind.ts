import { MigrationInterface, QueryRunner } from 'typeorm';

export class TripKind1794960364361 implements MigrationInterface {
  name = 'TripKind1794960364361';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip" ADD "kind" character varying NOT NULL DEFAULT 'trip'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trip" DROP COLUMN "kind"`);
  }
}
