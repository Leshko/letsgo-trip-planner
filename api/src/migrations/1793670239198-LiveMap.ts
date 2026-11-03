import { MigrationInterface, QueryRunner } from 'typeorm';

export class LiveMap1793670239198 implements MigrationInterface {
  name = 'LiveMap1793670239198';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "member_location" ("memberId" uuid NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "accuracy" integer NOT NULL DEFAULT '0', "updatedAt" bigint NOT NULL, CONSTRAINT "PK_4b048e1c043b019c14182069508" PRIMARY KEY ("memberId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "member" ADD "sharesLocation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_location" ADD CONSTRAINT "FK_4b048e1c043b019c14182069508" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "member_location" DROP CONSTRAINT "FK_4b048e1c043b019c14182069508"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member" DROP COLUMN "sharesLocation"`,
    );
    await queryRunner.query(`DROP TABLE "member_location"`);
  }
}
