import { MigrationInterface, QueryRunner } from 'typeorm';

export class NativePush1794015451049 implements MigrationInterface {
  name = 'NativePush1794015451049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscription" ADD "kind" character varying NOT NULL DEFAULT 'web'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscription" DROP COLUMN "kind"`,
    );
  }
}
