// CLI connections must bypass transaction pooling. SQL migrations remain authoritative:
// Prisma db push / migrate cannot reproduce this app's RLS, roles, triggers and functions.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const root = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== 'test') {
  for (const file of [path.join(root, '.env'), path.join(root, '..', '.env')]) {
    try { process.loadEnvFile(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.PRISMA_DATABASE_URL || process.env.MIGRATION_DATABASE_URL ||
      process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
