import { MigrationInterface, QueryRunner } from 'typeorm';

export class PushOrigin1793244282858 implements MigrationInterface {
  name = 'PushOrigin1793244282858';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscription" ADD "origin" character varying NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscription" DROP COLUMN "origin"`,
    );
  }
}
