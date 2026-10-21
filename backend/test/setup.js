// Preloaded with `node --import` before any test file, so configuration is
// always read in test mode (no .env files, quiet logging) regardless of the
// order in which a test file's own imports are evaluated.
process.env.NODE_ENV = 'test';
