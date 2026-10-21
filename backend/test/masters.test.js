import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { anon, createOrg, createUser, makeContext, signIn } from './helpers.js';

describe('master lists', () => {
  let ctx, platform, subscriber;
  before(async () => {
    ctx = await makeContext();
    const org = await createOrg(ctx.db, { name: 'Client' });
    await createUser(ctx.db, { orgId: org, email: 'sub@client.test' });
    platform = await signIn(ctx.app, 'admin@test.local');
    subscriber = await signIn(ctx.app, 'sub@client.test');
  });
  after(() => ctx.close());

  it('serves the starter lists to signed-in users only', async () => {
    assert.equal((await anon(ctx.app).get('/masters')).status, 401);
    const res = await subscriber.get('/masters');
    assert.equal(res.status, 200);
    assert.equal(res.body.states.length, 36, '28 states + 8 union territories');
    assert.ok(res.body.states.every((s) => s.nameHi), 'every state has a Hindi name');
    assert.ok(res.body.departments.length >= 25);
    assert.ok(res.body.categories.some((c) => c.name === 'Civil Works & Infrastructure'));
  });

  it('lists cities per state', async () => {
    const { states } = (await subscriber.get('/masters')).body;
    const mp = states.find((s) => s.name === 'Madhya Pradesh');
    const res = await subscriber.get(`/masters/cities?stateId=${mp.id}`);
    assert.ok(res.body.cities.some((c) => c.name === 'Bhopal'));
    assert.ok(res.body.cities.every((c) => c.stateId === mp.id));
  });

  it('lets only a platform admin change them', async () => {
    const body = { name: 'Mahanadi Coalfields Limited', tier: 'PSU', aliases: ['MCL'] };
    assert.equal((await subscriber.post('/masters/departments').send(body)).status, 403);
    const created = await platform.post('/masters/departments').send(body);
    assert.equal(created.status, 201);
    assert.equal(created.body.item.slug, 'mahanadi-coalfields-limited');
    assert.equal((await platform.post('/masters/departments').send(body)).status, 409, 'duplicate slug rejected');
  });

  it('keeps unrelated fields when patching (no silent resets)', async () => {
    const created = (await platform.post('/masters/departments').send({
      name: 'Tribal Welfare Department', tier: 'State', aliases: ['TWD'], nameHi: 'जनजातीय कल्याण विभाग' })).body.item;
    const patched = await platform.patch(`/masters/departments/${created.id}`).send({ isActive: false });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.item.tier, 'State');
    assert.deepEqual(patched.body.item.aliases, ['TWD']);
    assert.equal(patched.body.item.nameHi, 'जनजातीय कल्याण विभाग');
    assert.equal(patched.body.item.isActive, false);
    const visible = (await subscriber.get('/masters')).body.departments;
    assert.ok(!visible.some((d) => d.id === created.id), 'inactive entries drop out of filters');
  });

  it('adds states, cities and categories and rejects empty patches', async () => {
    const state = (await platform.post('/masters/states').send({ name: 'Test State', nameHi: 'टेस्ट', code: 'TS' })).body.item;
    const city = await platform.post('/masters/cities').send({ stateId: state.id, name: 'Test City' });
    assert.equal(city.status, 201);
    const cat = await platform.post('/masters/categories').send({ name: 'Furniture & Fixtures', aliases: ['Furniture'] });
    assert.equal(cat.status, 201);
    assert.equal((await platform.patch(`/masters/categories/${cat.body.item.id}`).send({})).status, 400);
    assert.equal((await platform.patch('/masters/categories/999999').send({ name: 'Nope' })).status, 404);
  });

  it('audits master data changes', async () => {
    const res = await platform.get('/admin/audit?limit=100');
    assert.ok(res.body.events.some((e) => e.action === 'master.department.create'));
  });
});
