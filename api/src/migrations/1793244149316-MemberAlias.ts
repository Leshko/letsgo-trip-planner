import { MigrationInterface, QueryRunner } from 'typeorm';

export class MemberAlias1793244149316 implements MigrationInterface {
  name = 'MemberAlias1793244149316';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "member_alias" ("createdAt" bigint NOT NULL, "token" character varying NOT NULL, "memberId" uuid NOT NULL, CONSTRAINT "PK_779db74e032130caae232de3f20" PRIMARY KEY ("token"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce2db54678d32f96218ff41f76" ON "member_alias" ("memberId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "member_alias" ADD CONSTRAINT "FK_ce2db54678d32f96218ff41f765" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "member_alias" DROP CONSTRAINT "FK_ce2db54678d32f96218ff41f765"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce2db54678d32f96218ff41f76"`,
    );
    await queryRunner.query(`DROP TABLE "member_alias"`);
  }
}
