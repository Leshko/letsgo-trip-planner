/**
 * One-time catch-up for accounts that existed before profiles: take each
 * account's profile from the trip spot that has a photo (the newest one), or
 * from their newest spot when none has, then apply it to all of their spots.
 *
 * Plain SQL only: this runs inside a migration, where the tables may be older
 * than the app's current entity definitions.
 */
export type RunSql = (sql: string, params?: unknown[]) => Promise<unknown>;

interface SpotRow {
  id: string;
  tripId: string;
  name: string;
  nameKey: string;
  emoji: string;
  avatar: Buffer | null;
  avatarType: string;
}

export async function backfillProfiles(
  run: RunSql,
): Promise<{ accounts: number; spots: number }> {
  const users = (await run(
    `SELECT u.id FROM app_user u
      WHERE u."profileName" = ''
        AND EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id)`,
  )) as { id: string }[];
  let spots = 0;
  for (const { id: userId } of users) {
    const mine = (await run(
      `SELECT id, "tripId", name, "nameKey", emoji, avatar, "avatarType"
         FROM member WHERE "userId" = $1
        ORDER BY (avatar IS NOT NULL) DESC, "createdAt" DESC`,
      [userId],
    )) as SpotRow[];
    const source = mine[0];
    const emoji = source.emoji || mine.find((s) => s.emoji)?.emoji || '';
    await run(
      `UPDATE app_user
          SET "profileName" = $2, emoji = $3, avatar = $4, "avatarType" = $5,
              "avatarVersion" = CASE WHEN $4::bytea IS NULL THEN 0 ELSE 1 END
        WHERE id = $1`,
      [
        userId,
        source.name,
        emoji,
        source.avatar,
        source.avatar ? source.avatarType : '',
      ],
    );
    for (const spot of mine) {
      if (spot.id !== source.id) spots++;
      // Emoji everywhere; the photo to spots that don't already have this exact one.
      await run(`UPDATE member SET emoji = $2 WHERE id = $1`, [spot.id, emoji]);
      if (source.avatar && spot.id !== source.id) {
        await run(
          `UPDATE member
              SET avatar = $2, "avatarType" = $3, "avatarVersion" = "avatarVersion" + 1
            WHERE id = $1`,
          [spot.id, source.avatar, source.avatarType],
        );
      }
      // The name too, unless someone else in that trip already uses it.
      if (spot.nameKey !== source.nameKey) {
        await run(
          `UPDATE member SET name = $2, "nameKey" = $3
            WHERE id = $1
              AND NOT EXISTS (
                SELECT 1 FROM member o
                 WHERE o."tripId" = $4 AND o."nameKey" = $3 AND o.id <> $1)`,
          [spot.id, source.name, source.nameKey, spot.tripId],
        );
      }
    }
  }
  return { accounts: users.length, spots };
}
