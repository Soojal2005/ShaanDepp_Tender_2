// Preloaded with `node --import` before any test file, so configuration is
// always read in test mode (no .env files, quiet logging) regardless of the
// order in which a test file's own imports are evaluated.
process.env.NODE_ENV = 'test';
// Lets tests observe the ops-alert emails the ingestion monitor queues.
process.env.OPS_ALERT_EMAIL = 'ops@test.local';
// Present so the admin "run now" endpoint accepts requests; tests inject a fake client, so no network is used.
process.env.TENDERBOOK_API_KEY = 'test-key-not-real';
