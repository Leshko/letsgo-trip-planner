import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillProfiles } from '../auth/profile-backfill';

export class UserProfile1794962118332 implements MigrationInterface {
  name = 'UserProfile1794962118332';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_user" ADD "profileName" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_user" ADD "emoji" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(`ALTER TABLE "app_user" ADD "avatar" bytea`);
    await queryRunner.query(
      `ALTER TABLE "app_user" ADD "avatarType" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_user" ADD "avatarVersion" integer NOT NULL DEFAULT '0'`,
    );
    // Accounts that already have trip spots: build their profile from the spot
    // with a photo and bring their other spots in line with it.
    await backfillProfiles((sql, params) => queryRunner.query(sql, params));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_user" DROP COLUMN "avatarVersion"`,
    );
    await queryRunner.query(`ALTER TABLE "app_user" DROP COLUMN "avatarType"`);
    await queryRunner.query(`ALTER TABLE "app_user" DROP COLUMN "avatar"`);
    await queryRunner.query(`ALTER TABLE "app_user" DROP COLUMN "emoji"`);
    await queryRunner.query(`ALTER TABLE "app_user" DROP COLUMN "profileName"`);
  }
}
