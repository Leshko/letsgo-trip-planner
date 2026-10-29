// Each suite calls freshDatabase() before booting the app; see test/db.ts.
delete process.env.DB_PATH;
process.env.MAIL_DEV_OUTBOX = 'memory';
