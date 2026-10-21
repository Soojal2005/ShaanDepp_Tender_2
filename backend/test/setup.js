// Preloaded with `node --import` before any test file, so configuration is
// always read in test mode (no .env files, quiet logging) regardless of the
// order in which a test file's own imports are evaluated.
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
// Lets tests observe the ops-alert emails the ingestion monitor queues.
process.env.OPS_ALERT_EMAIL = 'ops@test.local';
// Present so the admin "run now" endpoint accepts requests; tests inject a fake client, so no network is used.
process.env.TENDERBOOK_API_KEY = 'test-key-not-real';
// Dry-run mail files and uploads go to a temporary folder, never into the project.
process.env.OUTBOX_DIR = path.join(os.tmpdir(), 'pb-test-outbox');
process.env.STORAGE_DIR = path.join(os.tmpdir(), 'pb-test-storage');
