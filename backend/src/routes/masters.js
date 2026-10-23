/**
 * Master lists the client controls (states, cities, departments, categories).
 * Any signed-in user can read them to populate filters; only platform admins
 * can change them.
 */
import { Router } from 'express';
import { requireAuth, requirePermission, withUserPrisma, withSystemDb } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { actorOf, audit } from '../services/audit.js';
import { slugify } from '../util.js';
import { id, parse, z } from '../validate.js';

// Create and patch schemas are built separately: in Zod 4 a `.default()` inside
// `.partial()` is still applied, which would silently reset omitted fields on PATCH.
const aliases = z.array(z.string().trim().min(1).max(200)).max(50);

const departmentShape = {
  name: z.string().trim().min(2).max(200),
  nameHi: z.string().trim().max(200).nullish(),
  tier: z.enum(['Central', 'State', 'PSU', 'Municipal']),
  aliases,
  isActive: z.boolean(),
};
const categoryShape = {
  name: z.string().trim().min(2).max(150),
  nameHi: z.string().trim().max(150).nullish(),
  aliases,
  isActive: z.boolean(),
};
const stateShape = {
  name: z.string().trim().min(2).max(100),
  nameHi: z.string().trim().max(100).nullish(),
  code: z.string().trim().max(10).nullish(),
  aliases,
};
const cityShape = { stateId: id, name: z.string().trim().min(2).max(100) };

const departmentFields = {
  create: z.object({
    ...departmentShape,
    tier: departmentShape.tier.default('Central'),
    aliases: aliases.default([]),
    isActive: z.boolean().default(true),
  }),
  patch: z.object(departmentShape).partial(),
};
const categoryFields = {
  create: z.object({ ...categoryShape, aliases: aliases.default([]), isActive: z.boolean().default(true) }),
  patch: z.object(categoryShape).partial(),
};
const stateFields = {
  create: z.object({ ...stateShape, aliases: aliases.default([]) }),
  patch: z.object(stateShape).partial(),
};
const cityFields = { create: z.object(cityShape), patch: z.object(cityShape).partial() };

const viewDept = (r) => ({ id: r.id, slug: r.slug, name: r.name, nameHi: r.name_hi, tier: r.tier, aliases: r.aliases, isActive: r.is_active });
const viewCat = (r) => ({ id: r.id, slug: r.slug, name: r.name, nameHi: r.name_hi, aliases: r.aliases, isActive: r.is_active });
const viewState = (r) => ({ id: r.id, name: r.name, nameHi: r.name_hi, code: r.code, aliases: r.aliases });
const viewCity = (r) => ({ id: r.id, stateId: r.state_id, name: r.name });

export function mastersRoutes() {
  const r = Router();

  // ---- Read (any signed-in user) -------------------------------------------
  r.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      // Filters only offer active entries; administrators can ask for everything (?all=1).
      const includeInactive = req.query.all === '1' && can(req.auth.user, 'masters:manage');
      const result = await withUserPrisma(req, async (tx) => ({
        states: (await tx.states.findMany({ orderBy: { name: 'asc' } })).map(viewState),
        departments: (await tx.departments.findMany({ where: includeInactive ? {} : { is_active: true }, orderBy: { name: 'asc' } })).map(viewDept),
        categories: (await tx.tender_categories.findMany({ where: includeInactive ? {} : { is_active: true }, orderBy: { name: 'asc' } })).map(viewCat),
      }));
      res.json(result);
    })
  );

  r.get(
    '/cities',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { stateId } = parse(z.object({ stateId: id.optional() }), req.query);
      const rows = await withUserPrisma(req, (tx) =>
        tx.cities.findMany({ where: stateId == null ? {} : { state_id: stateId }, orderBy: { name: 'asc' }, take: 5000 })
      );
      res.json({ cities: rows.map(viewCity) });
    })
  );

  // ---- Write (platform admin) ----------------------------------------------
  const write = Router();
  write.use(requirePermission('masters:manage'));

  const create = (path, fields, run, entity) =>
    write.post(
      path,
      asyncHandler(async (req, res) => {
        const input = parse(fields.create, req.body);
        const row = await withSystemDb(req, async (q) => {
          const created = await run(q, input);
          await audit(q, actorOf(req), `master.${entity}.create`, entity, created.id, { name: input.name });
          return created;
        });
        res.status(201).json({ item: row });
      })
    );

  const update = (path, fields, run, entity) =>
    write.patch(
      `${path}/:itemId`,
      asyncHandler(async (req, res) => {
        const itemId = parse(z.object({ itemId: id }), req.params).itemId;
        const patch = parse(fields.patch, req.body);
        if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
        const row = await withSystemDb(req, async (q) => {
          const updated = await run(q, itemId, patch);
          if (!updated) throw notFound('Item not found');
          await audit(q, actorOf(req), `master.${entity}.update`, entity, itemId, { changed: Object.keys(patch) });
          return updated;
        });
        res.json({ item: row });
      })
    );

  create('/departments', departmentFields, async (q, v) =>
    viewDept(await q.one(
      `INSERT INTO departments (slug, name, name_hi, tier, aliases, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [slugify(v.name), v.name, v.nameHi ?? null, v.tier, v.aliases, v.isActive])), 'department');
  update('/departments', departmentFields, async (q, itemId, p) => {
    const cur = await q.maybeOne('SELECT * FROM departments WHERE id = $1', [itemId]);
    if (!cur) return null;
    return viewDept(await q.one(
      `UPDATE departments SET name=$1, name_hi=$2, tier=$3, aliases=$4, is_active=$5 WHERE id=$6 RETURNING *`,
      [p.name ?? cur.name, p.nameHi === undefined ? cur.name_hi : p.nameHi, p.tier ?? cur.tier,
       p.aliases ?? cur.aliases, p.isActive ?? cur.is_active, itemId]));
  }, 'department');

  create('/categories', categoryFields, async (q, v) =>
    viewCat(await q.one(
      `INSERT INTO tender_categories (slug, name, name_hi, aliases, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [slugify(v.name), v.name, v.nameHi ?? null, v.aliases, v.isActive])), 'category');
  update('/categories', categoryFields, async (q, itemId, p) => {
    const cur = await q.maybeOne('SELECT * FROM tender_categories WHERE id = $1', [itemId]);
    if (!cur) return null;
    return viewCat(await q.one(
      `UPDATE tender_categories SET name=$1, name_hi=$2, aliases=$3, is_active=$4 WHERE id=$5 RETURNING *`,
      [p.name ?? cur.name, p.nameHi === undefined ? cur.name_hi : p.nameHi, p.aliases ?? cur.aliases,
       p.isActive ?? cur.is_active, itemId]));
  }, 'category');

  create('/states', stateFields, async (q, v) =>
    viewState(await q.one(
      `INSERT INTO states (name, name_hi, code, aliases) VALUES ($1,$2,$3,$4) RETURNING *`,
      [v.name, v.nameHi ?? null, v.code ?? null, v.aliases])), 'state');
  update('/states', stateFields, async (q, itemId, p) => {
    const cur = await q.maybeOne('SELECT * FROM states WHERE id = $1', [itemId]);
    if (!cur) return null;
    return viewState(await q.one(
      `UPDATE states SET name=$1, name_hi=$2, code=$3, aliases=$4 WHERE id=$5 RETURNING *`,
      [p.name ?? cur.name, p.nameHi === undefined ? cur.name_hi : p.nameHi,
       p.code === undefined ? cur.code : p.code, p.aliases ?? cur.aliases, itemId]));
  }, 'state');

  create('/cities', cityFields, async (q, v) =>
    viewCity(await q.one(`INSERT INTO cities (state_id, name) VALUES ($1,$2) RETURNING *`, [v.stateId, v.name])), 'city');
  update('/cities', cityFields, async (q, itemId, p) => {
    const cur = await q.maybeOne('SELECT * FROM cities WHERE id = $1', [itemId]);
    if (!cur) return null;
    return viewCity(await q.one(`UPDATE cities SET state_id=$1, name=$2 WHERE id=$3 RETURNING *`,
      [p.stateId ?? cur.state_id, p.name ?? cur.name, itemId]));
  }, 'city');

  r.use('/', write);
  return r;
}
