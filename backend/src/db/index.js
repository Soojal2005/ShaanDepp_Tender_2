/**
 * Database access for both engines: embedded PGlite (development, tests) and
 * a real PostgreSQL pool (production). The SQL is identical on both.
 *
 * Every request-level query goes through withContext(), which opens a
 * transaction, drops to the unprivileged `app_api_user` role and sets the
 * tenant/scope settings the row-level-security policies read. There is no
 * other path from application code to the data.
 */
import fs from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';

const OID_INT8 = 20;
const OID_NUMERIC = 1700;
const OID_DATE = 1082;

// Row values: bigint/numeric as JS numbers, DATE as 'YYYY-MM-DD' (no timezone drift).
pg.types.setTypeParser(OID_INT8, (v) => Number(v));
pg.types.setTypeParser(OID_NUMERIC, (v) => Number(v));
pg.types.setTypeParser(OID_DATE, (v) => v);

const PGLITE_PARSERS = {
  [OID_INT8]: (v) => Number(v),
  [OID_NUMERIC]: (v) => Number(v),
  [OID_DATE]: (v) => v,
};

export const SCOPES = Object.freeze(['tenant', 'staff', 'system']);

function normalize(result) {
  const rows = result.rows ?? [];
  return { rows, rowCount: result.affectedRows || result.rowCount || rows.length };
}

/** Wraps a raw transaction handle with the small helper API the services use. */
function wrapTransaction(raw) {
  let savepointSeq = 0;
  const q = {
    async query(sql, params = []) {
      return normalize(await raw.query(sql, params));
    },
    async many(sql, params = []) {
      return (await q.query(sql, params)).rows;
    },
    async maybeOne(sql, params = []) {
      const { rows } = await q.query(sql, params);
      if (rows.length > 1) throw new Error(`Expected at most one row, got ${rows.length}`);
      return rows[0] ?? null;
    },
    async one(sql, params = []) {
      const row = await q.maybeOne(sql, params);
      if (!row) throw new Error('Expected one row, got none');
      return row;
    },
    /** Run fn inside a savepoint so a failure doesn't abort the whole transaction. */
    async savepoint(fn) {
      const name = `sp_${++savepointSeq}`;
      await raw.query(`SAVEPOINT ${name}`);
      try {
        const value = await fn(q);
        await raw.query(`RELEASE SAVEPOINT ${name}`);
        return value;
      } catch (err) {
        await raw.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await raw.query(`RELEASE SAVEPOINT ${name}`);
        throw err;
      }
    },
  };
  return q;
}

function assertContext(ctx) {
  if (!ctx || !SCOPES.includes(ctx.scope)) {
    throw new Error(`withContext: scope must be one of ${SCOPES.join(', ')}`);
  }
  if (ctx.scope === 'tenant' && !Number.isInteger(ctx.orgId)) {
    throw new Error('withContext: tenant scope requires an integer orgId');
  }
}

async function applyContext(tx, ctx) {
  await tx.query('SET LOCAL ROLE app_api_user');
  await tx.query(
    `SELECT set_config('app.current_organization_id', $1, true),
            set_config('app.actor_scope', $2, true),
            set_config('app.current_user_id', $3, true)`,
    [ctx.orgId == null ? '' : String(ctx.orgId), ctx.scope, ctx.userId == null ? '' : String(ctx.userId)]
  );
}

async function createPglite(options) {
  if (options.pgliteDir !== 'memory://') fs.mkdirSync(options.pgliteDir, { recursive: true });
  const engine = await PGlite.create({ dataDir: options.pgliteDir, parsers: PGLITE_PARSERS });
  return {
    kind: 'pglite',
    async transaction(fn) {
      return engine.transaction((tx) => fn(tx));
    },
    exec: (sql) => engine.exec(sql),
    query: (sql, params) => engine.query(sql, params),
    close: () => engine.close(),
  };
}

async function createPg(options) {
  const runtime = new pg.Pool({ connectionString: options.url, max: 10 });
  const migration = options.migrationUrl === options.url
    ? runtime
    : new pg.Pool({ connectionString: options.migrationUrl, max: 2 });
  return {
    kind: 'pg',
    async transaction(fn) {
      const client = await runtime.connect();
      try {
        await client.query('BEGIN');
        const value = await fn(client);
        await client.query('COMMIT');
        return value;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    exec: (sql) => migration.query(sql),
    query: (sql, params) => migration.query(sql, params),
    close: async () => {
      await runtime.end();
      if (migration !== runtime) await migration.end();
    },
  };
}

/**
 * @param {{driver?: 'pg'|'pglite', url?: string, migrationUrl?: string, pgliteDir?: string}} [options]
 */
export async function createDatabase(options = config.db) {
  const engine = options.driver === 'pg' ? await createPg(options) : await createPglite(options);

  return {
    kind: engine.kind,
    /** Superuser-level access for migrations and role bootstrap only. */
    admin: { exec: engine.exec, query: engine.query },

    /**
     * Run fn(q) in one transaction under the given request context.
     * ctx = { scope: 'tenant'|'staff'|'system', orgId?, userId? }
     */
    async withContext(ctx, fn) {
      assertContext(ctx);
      return engine.transaction(async (tx) => {
        await applyContext(tx, ctx);
        return fn(wrapTransaction(tx));
      });
    },

    async health() {
      const { rows } = await engine.query('SELECT 1 AS ok');
      return rows[0]?.ok === 1;
    },

    close: () => engine.close(),
  };
}

let singleton;
/** Process-wide database used by the server and the scheduler. */
export async function getDb() {
  singleton ??= createDatabase();
  return singleton;
}
export async function closeDb() {
  if (singleton) {
    const db = await singleton;
    singleton = undefined;
    await db.close();
  }
}
