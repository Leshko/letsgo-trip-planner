import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1793238956651 implements MigrationInterface {
  name = 'Init1793238956651';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "member" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "name" character varying NOT NULL, "nameKey" character varying NOT NULL, "token" character varying NOT NULL, "isOwner" boolean NOT NULL DEFAULT false, "emoji" character varying NOT NULL DEFAULT '', "avatar" bytea, "avatarType" character varying NOT NULL DEFAULT '', "avatarVersion" integer NOT NULL DEFAULT '0', "notifyPrefs" text NOT NULL DEFAULT '{}', CONSTRAINT "UQ_83c35e59f237321967de6d13173" UNIQUE ("token"), CONSTRAINT "PK_97cbbe986ce9d14ca5894fdc072" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_83c35e59f237321967de6d1317" ON "member" ("token") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fa60a9657760073ae662913541" ON "member" ("tripId", "nameKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "trip" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "destination" character varying NOT NULL DEFAULT '', "startDate" character varying NOT NULL, "endDate" character varying NOT NULL, "inviteCode" character varying NOT NULL, "lodging" text NOT NULL, CONSTRAINT "UQ_c436f47ec18d92530b850fd5746" UNIQUE ("inviteCode"), CONSTRAINT "PK_714c23d558208081dbccb9d9268" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vote" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ideaId" uuid NOT NULL, "memberId" uuid NOT NULL, CONSTRAINT "PK_2d5932d46afe39c8176f9d4be72" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6e5333421fcfc382549771d0f2" ON "vote" ("ideaId", "memberId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "idea" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "kind" character varying NOT NULL, "title" character varying NOT NULL, "description" character varying NOT NULL DEFAULT '', "link" character varying NOT NULL DEFAULT '', "address" character varying NOT NULL DEFAULT '', "menuUrl" character varying NOT NULL DEFAULT '', "cost" character varying NOT NULL DEFAULT '', "imageUrl" character varying NOT NULL DEFAULT '', "siteName" character varying NOT NULL DEFAULT '', "details" text NOT NULL DEFAULT '[]', "suggestedById" uuid NOT NULL, CONSTRAINT "PK_5096f543c484b349f5234da9d97" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6acc9b026843d1f23c810d4fd0" ON "idea" ("tripId", "kind") `,
    );
    await queryRunner.query(
      `CREATE TABLE "itinerary_entry" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "date" character varying NOT NULL, "startTime" character varying NOT NULL DEFAULT '', "title" character varying NOT NULL, "notes" character varying NOT NULL DEFAULT '', "ideaId" uuid, "position" integer NOT NULL DEFAULT '0', "addedById" uuid NOT NULL, CONSTRAINT "PK_09250036a46e821ed0bef507780" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f632625f02ed65ceb1a4f17b15" ON "itinerary_entry" ("tripId", "date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "comment" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "ideaId" uuid NOT NULL, "memberId" uuid NOT NULL, "body" character varying NOT NULL, CONSTRAINT "PK_0b0e4bbc8415ec426f87f3a88e2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_861b419cce1c9ae64295300d6b" ON "comment" ("ideaId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "post" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "memberId" uuid NOT NULL, "body" character varying NOT NULL, "reactions" text NOT NULL, CONSTRAINT "PK_be5fda3aac270b134ff9c21cdee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c7a0068a3e3c1233044c106b8" ON "post" ("tripId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "activity" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "memberId" uuid NOT NULL, "type" character varying NOT NULL, "message" character varying NOT NULL, "refKind" character varying, "refId" character varying, CONSTRAINT "PK_24625a1d6b1b089c8ae206fe467" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f1d242a9b9396de77e0633e55" ON "activity" ("tripId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "transfer_code" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "memberId" uuid NOT NULL, "expiresAt" bigint NOT NULL, "usedAt" bigint, CONSTRAINT "UQ_fdacc10ff66b3efb5c937e1dfc0" UNIQUE ("code"), CONSTRAINT "PK_2a60b13d15b49dd30e4edc20589" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdacc10ff66b3efb5c937e1dfc" ON "transfer_code" ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "photo" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "memberId" uuid NOT NULL, "batchId" character varying NOT NULL, "caption" character varying NOT NULL DEFAULT '', "originalName" character varying NOT NULL, "mimeType" character varying NOT NULL, "ext" character varying NOT NULL, "bytes" integer NOT NULL, "width" integer, "height" integer, "hasThumb" boolean NOT NULL DEFAULT false, "hasPreview" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_723fa50bf70dcfd06fb5a44d4ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a2d007e1b3dff2994ba8b1eec" ON "photo" ("batchId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9770778ac7b77ab81ee39df92" ON "photo" ("tripId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "photo_comment" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "photoId" uuid NOT NULL, "memberId" uuid NOT NULL, "body" character varying NOT NULL, CONSTRAINT "PK_8af113a71c18c4c17b0a1dff707" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2d1c53def74be734e2d2bc7e6" ON "photo_comment" ("photoId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notification" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tripId" uuid NOT NULL, "memberId" uuid NOT NULL, "actorId" uuid NOT NULL, "type" character varying NOT NULL, "message" character varying NOT NULL, "refKind" character varying, "refId" character varying, "readAt" bigint, CONSTRAINT "PK_705b6c7cdf9b2c2ff7ac7872cb7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fcc979615380de86c8ba4627f7" ON "notification" ("memberId", "readAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7801b89eca3579dd0f0d441976" ON "notification" ("memberId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "push_subscription" ("createdAt" bigint NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "memberId" uuid NOT NULL, "endpoint" character varying NOT NULL, "p256dh" character varying NOT NULL, "auth" character varying NOT NULL, "userAgent" character varying NOT NULL DEFAULT '', CONSTRAINT "UQ_27ae9074fc39a09bc1aee263df5" UNIQUE ("endpoint"), CONSTRAINT "PK_07fc861c0d2c38c1b830fb9cb5d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b30bff6d939f959a526de28c0" ON "push_subscription" ("memberId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "unfurl_cache" ("createdAt" bigint NOT NULL, "urlHash" character varying NOT NULL, "url" character varying NOT NULL, "model" character varying NOT NULL, "json" text NOT NULL, CONSTRAINT "PK_abf9d7e9655587d0d024b190e60" PRIMARY KEY ("urlHash"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "legacy_import" ("id" character varying NOT NULL, "importedAt" bigint NOT NULL, "source" character varying NOT NULL, "counts" text NOT NULL, CONSTRAINT "PK_deffd9c49b494a48320f595eb78" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "member" ADD CONSTRAINT "FK_931679ccd848f6627911fbd795f" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote" ADD CONSTRAINT "FK_419bcc6e476efcfe8bea5806955" FOREIGN KEY ("ideaId") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote" ADD CONSTRAINT "FK_9dd169b93b26451a125f0f577e7" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "idea" ADD CONSTRAINT "FK_03d65ef1d2a84b6b724dfac3948" FOREIGN KEY ("suggestedById") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "itinerary_entry" ADD CONSTRAINT "FK_ccea9cb348cef971fff5f4cf23f" FOREIGN KEY ("ideaId") REFERENCES "idea"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "itinerary_entry" ADD CONSTRAINT "FK_2276dd551be2461f7ae4d4f6edf" FOREIGN KEY ("addedById") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment" ADD CONSTRAINT "FK_861b419cce1c9ae64295300d6b6" FOREIGN KEY ("ideaId") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment" ADD CONSTRAINT "FK_7e3751987451830b1541ba8b916" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD CONSTRAINT "FK_d66317a245feea1779c17994c32" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity" ADD CONSTRAINT "FK_48a8b8f55128d1fbef331cacdf9" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transfer_code" ADD CONSTRAINT "FK_8511fb1ec05ffe1ac23c5f78195" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "photo" ADD CONSTRAINT "FK_b385e1b1da5eba507b5ce261cc0" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "photo_comment" ADD CONSTRAINT "FK_f2d1c53def74be734e2d2bc7e6b" FOREIGN KEY ("photoId") REFERENCES "photo"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "photo_comment" ADD CONSTRAINT "FK_b009dd9f8bfef73e3ceaeb5d486" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_adeb547544a66c2b1293643190c" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_c5133a026bd1b3d9feccac1a234" FOREIGN KEY ("actorId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscription" ADD CONSTRAINT "FK_8b30bff6d939f959a526de28c00" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscription" DROP CONSTRAINT "FK_8b30bff6d939f959a526de28c00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "FK_c5133a026bd1b3d9feccac1a234"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "FK_adeb547544a66c2b1293643190c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "photo_comment" DROP CONSTRAINT "FK_b009dd9f8bfef73e3ceaeb5d486"`,
    );
    await queryRunner.query(
      `ALTER TABLE "photo_comment" DROP CONSTRAINT "FK_f2d1c53def74be734e2d2bc7e6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "photo" DROP CONSTRAINT "FK_b385e1b1da5eba507b5ce261cc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transfer_code" DROP CONSTRAINT "FK_8511fb1ec05ffe1ac23c5f78195"`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity" DROP CONSTRAINT "FK_48a8b8f55128d1fbef331cacdf9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" DROP CONSTRAINT "FK_d66317a245feea1779c17994c32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment" DROP CONSTRAINT "FK_7e3751987451830b1541ba8b916"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment" DROP CONSTRAINT "FK_861b419cce1c9ae64295300d6b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "itinerary_entry" DROP CONSTRAINT "FK_2276dd551be2461f7ae4d4f6edf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "itinerary_entry" DROP CONSTRAINT "FK_ccea9cb348cef971fff5f4cf23f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "idea" DROP CONSTRAINT "FK_03d65ef1d2a84b6b724dfac3948"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote" DROP CONSTRAINT "FK_9dd169b93b26451a125f0f577e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote" DROP CONSTRAINT "FK_419bcc6e476efcfe8bea5806955"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member" DROP CONSTRAINT "FK_931679ccd848f6627911fbd795f"`,
    );
    await queryRunner.query(`DROP TABLE "legacy_import"`);
    await queryRunner.query(`DROP TABLE "unfurl_cache"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b30bff6d939f959a526de28c0"`,
    );
    await queryRunner.query(`DROP TABLE "push_subscription"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7801b89eca3579dd0f0d441976"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fcc979615380de86c8ba4627f7"`,
    );
    await queryRunner.query(`DROP TABLE "notification"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2d1c53def74be734e2d2bc7e6"`,
    );
    await queryRunner.query(`DROP TABLE "photo_comment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9770778ac7b77ab81ee39df92"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a2d007e1b3dff2994ba8b1eec"`,
    );
    await queryRunner.query(`DROP TABLE "photo"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdacc10ff66b3efb5c937e1dfc"`,
    );
    await queryRunner.query(`DROP TABLE "transfer_code"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f1d242a9b9396de77e0633e55"`,
    );
    await queryRunner.query(`DROP TABLE "activity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c7a0068a3e3c1233044c106b8"`,
    );
    await queryRunner.query(`DROP TABLE "post"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_861b419cce1c9ae64295300d6b"`,
    );
    await queryRunner.query(`DROP TABLE "comment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f632625f02ed65ceb1a4f17b15"`,
    );
    await queryRunner.query(`DROP TABLE "itinerary_entry"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6acc9b026843d1f23c810d4fd0"`,
    );
    await queryRunner.query(`DROP TABLE "idea"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e5333421fcfc382549771d0f2"`,
    );
    await queryRunner.query(`DROP TABLE "vote"`);
    await queryRunner.query(`DROP TABLE "trip"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa60a9657760073ae662913541"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_83c35e59f237321967de6d1317"`,
    );
    await queryRunner.query(`DROP TABLE "member"`);
  }
}
