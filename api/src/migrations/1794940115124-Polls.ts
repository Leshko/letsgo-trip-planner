import { MigrationInterface, QueryRunner } from 'typeorm';

export class Polls1794940115124 implements MigrationInterface {
  name = 'Polls1794940115124';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "post" ADD "poll" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "post" DROP COLUMN "poll"`);
  }
}
