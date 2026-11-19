import { MigrationInterface, QueryRunner } from 'typeorm';

export class SelfieGame1795095536011 implements MigrationInterface {
  name = 'SelfieGame1795095536011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "selfie_challenge" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "position" integer NOT NULL, "title" character varying NOT NULL, "hint" character varying NOT NULL DEFAULT '', "difficulty" character varying NOT NULL DEFAULT 'easy', "points" integer NOT NULL, "source" character varying NOT NULL DEFAULT 'ai', "retiredAt" bigint, CONSTRAINT "PK_f7ae1f6e940255ddd865fc7b5fb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74df1b7e7287d12ce18e24907a" ON "selfie_challenge" ("tripId", "position") `,
    );
    await queryRunner.query(
      `CREATE TABLE "selfie_entry" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "challengeId" uuid NOT NULL, "tripId" uuid NOT NULL, "memberId" uuid NOT NULL, "photoId" uuid NOT NULL, "status" character varying NOT NULL, "judgedBy" character varying NOT NULL, "comment" character varying NOT NULL DEFAULT '', "points" integer NOT NULL DEFAULT '0', "bonus" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_45981463fb6072a22469753b821" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad8aa33b54cafd4516d84161ca" ON "selfie_entry" ("tripId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a97a73319964ab3f1eec8813d6" ON "selfie_entry" ("challengeId", "memberId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "trip" ADD "selfieGame" character varying NOT NULL DEFAULT 'on'`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_challenge" ADD CONSTRAINT "FK_d407265bc2d4aef57af285e8dd7" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_entry" ADD CONSTRAINT "FK_15f7235dc5985c91e2d4498acd4" FOREIGN KEY ("challengeId") REFERENCES "selfie_challenge"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_entry" ADD CONSTRAINT "FK_6b218e2c4e758837e18b82bcc19" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_entry" ADD CONSTRAINT "FK_f8dd6163907e01b9ca8de75f966" FOREIGN KEY ("photoId") REFERENCES "photo"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "selfie_entry" DROP CONSTRAINT "FK_f8dd6163907e01b9ca8de75f966"`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_entry" DROP CONSTRAINT "FK_6b218e2c4e758837e18b82bcc19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_entry" DROP CONSTRAINT "FK_15f7235dc5985c91e2d4498acd4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "selfie_challenge" DROP CONSTRAINT "FK_d407265bc2d4aef57af285e8dd7"`,
    );
    await queryRunner.query(`ALTER TABLE "trip" DROP COLUMN "selfieGame"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a97a73319964ab3f1eec8813d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad8aa33b54cafd4516d84161ca"`,
    );
    await queryRunner.query(`DROP TABLE "selfie_entry"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74df1b7e7287d12ce18e24907a"`,
    );
    await queryRunner.query(`DROP TABLE "selfie_challenge"`);
  }
}
