import { MigrationInterface, QueryRunner } from 'typeorm';

export class TripTimeZone1793671798725 implements MigrationInterface {
  name = 'TripTimeZone1793671798725';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip" ADD "timeZone" character varying NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trip" DROP COLUMN "timeZone"`);
  }
}
