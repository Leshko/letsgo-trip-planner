import { MigrationInterface, QueryRunner } from 'typeorm';

export class Accounts1793239325973 implements MigrationInterface {
  name = 'Accounts1793239325973';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "app_user" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying, "name" character varying NOT NULL DEFAULT '', "lastSignInAt" bigint, CONSTRAINT "UQ_3fa909d0e37c531ebc237703391" UNIQUE ("email"), CONSTRAINT "PK_22a5c4a3d9b2fb8e4e73fc4ada1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_identity" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "provider" character varying NOT NULL, "subject" character varying NOT NULL, "email" character varying NOT NULL DEFAULT '', CONSTRAINT "PK_87b5856b206b5b77e6e2fa29508" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d46a525c55104a04b24cb6639" ON "user_identity" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_04119a35391317c052ae392283" ON "user_identity" ("provider", "subject") `,
    );
    await queryRunner.query(
      `CREATE TABLE "account_session" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" bigint NOT NULL, "lastUsedAt" bigint NOT NULL, "userAgent" character varying NOT NULL DEFAULT '', CONSTRAINT "UQ_6c962a21e4f3baa6ece7e1add17" UNIQUE ("tokenHash"), CONSTRAINT "PK_5c3e060425fa96014c285fc6c1e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_343f833aa76591a953fa06c0ab" ON "account_session" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "email_code" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "codeHash" character varying NOT NULL, "linkHash" character varying NOT NULL, "expiresAt" bigint NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "usedAt" bigint, CONSTRAINT "UQ_b364bff6ce6adcc93bd695be8d3" UNIQUE ("linkHash"), CONSTRAINT "PK_d2df8df5dfc4063f18fb7a576da" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ddd368aecc1f8223910f32d29" ON "email_code" ("email", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_flow" ("state" character varying NOT NULL, "provider" character varying NOT NULL, "verifier" character varying NOT NULL, "nonce" character varying NOT NULL, "returnTo" character varying NOT NULL DEFAULT '/trips', "expiresAt" bigint NOT NULL, CONSTRAINT "PK_33630baa6b2220147f3b3a7cab2" PRIMARY KEY ("state"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_handoff" ("codeHash" character varying NOT NULL, "userId" uuid NOT NULL, "expiresAt" bigint NOT NULL, CONSTRAINT "PK_e4b3015f341a4a046ef531a8ed4" PRIMARY KEY ("codeHash"))`,
    );
    await queryRunner.query(`ALTER TABLE "member" ADD "userId" uuid`);
    await queryRunner.query(`ALTER TABLE "trip" ADD "ownerUserId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_08897b166dee565859b7fb2fcc" ON "member" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_79619a4e5ddf9d53ad3a5a327c" ON "member" ("tripId", "userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_047a0740feca9b0472497efabb" ON "trip" ("ownerUserId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user_identity" ADD CONSTRAINT "FK_6d46a525c55104a04b24cb66391" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_session" ADD CONSTRAINT "FK_343f833aa76591a953fa06c0ab4" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_handoff" ADD CONSTRAINT "FK_148880715b9a0660b63112174a3" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member" ADD CONSTRAINT "FK_08897b166dee565859b7fb2fcc8" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip" ADD CONSTRAINT "FK_047a0740feca9b0472497efabb4" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip" DROP CONSTRAINT "FK_047a0740feca9b0472497efabb4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member" DROP CONSTRAINT "FK_08897b166dee565859b7fb2fcc8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_handoff" DROP CONSTRAINT "FK_148880715b9a0660b63112174a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_session" DROP CONSTRAINT "FK_343f833aa76591a953fa06c0ab4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_identity" DROP CONSTRAINT "FK_6d46a525c55104a04b24cb66391"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_047a0740feca9b0472497efabb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79619a4e5ddf9d53ad3a5a327c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08897b166dee565859b7fb2fcc"`,
    );
    await queryRunner.query(`ALTER TABLE "trip" DROP COLUMN "ownerUserId"`);
    await queryRunner.query(`ALTER TABLE "member" DROP COLUMN "userId"`);
    await queryRunner.query(`DROP TABLE "auth_handoff"`);
    await queryRunner.query(`DROP TABLE "auth_flow"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ddd368aecc1f8223910f32d29"`,
    );
    await queryRunner.query(`DROP TABLE "email_code"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_343f833aa76591a953fa06c0ab"`,
    );
    await queryRunner.query(`DROP TABLE "account_session"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04119a35391317c052ae392283"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d46a525c55104a04b24cb6639"`,
    );
    await queryRunner.query(`DROP TABLE "user_identity"`);
    await queryRunner.query(`DROP TABLE "app_user"`);
  }
}
