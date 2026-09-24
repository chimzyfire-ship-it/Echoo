const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
let db;
const founder = '11111111-1111-4111-8111-111111111111';
const fresh = '22222222-2222-4222-8222-222222222222';
const reviewer = '33333333-3333-4333-8333-333333333333';
const migration = readFileSync(path.join(__dirname, '../../supabase/migrations/202609240001_mobile_subscriptions.sql'), 'utf8');
async function role(name, id = fresh) {
  await db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role ${name};`);
}
async function access(id) { return (await db.query('select public.mobile_access_for($1) as access', [id])).rows[0].access; }
async function reserve(id, bucket) { return (await db.query('select public.reserve_mobile_usage($1,$2) as ok', [id, bucket])).rows[0].ok; }
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite'); db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key); insert into auth.users values('${founder}');`);
  await db.exec(migration);
  await db.exec(`insert into auth.users values('${fresh}'),('${reviewer}');`);
});
after(async () => { await db?.close(); });

test('existing users have permanent full access; future registrations are locked', async () => {
  await role('service_role');
  const existing = await access(founder);
  assert.equal(existing.active, true); assert.equal(existing.source, 'founder');
  assert.equal(existing.expiresAt, null); assert.equal(existing.routeLimit, null);
  for (let i = 0; i < 55; i++) assert.equal(await reserve(founder, 'routes'), true);
  assert.equal((await access(fresh)).active, false);
  assert.equal(await reserve(fresh, 'routes'), false);
});
test('users cannot grant themselves access, modify quotas or forge subscriptions', async () => {
  for (const name of ['anon', 'authenticated']) {
    await role(name);
    await assert.rejects(db.query('select * from public.mobile_access_grants'), /permission denied/);
    await assert.rejects(db.query(`insert into public.mobile_access_grants(user_id,kind,note) values($1,'founder','forged')`, [fresh]), /permission denied/);
    await assert.rejects(db.query(`select public.mobile_access_for($1)`, [founder]), /permission denied/);
    await assert.rejects(db.query(`select public.reserve_mobile_usage($1,'routes')`, [fresh]), /permission denied/);
    await assert.rejects(db.query(`select public.sync_mobile_subscription($1,'city_all_access',now()+interval '1 month','app_store',now())`, [fresh]), /permission denied/);
  }
  await role('authenticated', founder);
  assert.equal((await db.query('select public.my_mobile_access() as a')).rows[0].a.source, 'founder');
  await role('authenticated', fresh);
  assert.equal((await db.query('select public.my_mobile_access() as a')).rows[0].a.active, false);
});
test('verified purchases unlock; quotas are atomic and failed attempts can be refunded', async () => {
  await role('service_role');
  await db.query(`select public.sync_mobile_subscription($1,'city_pass',now()+interval '1 month','app_store',now())`, [fresh]);
  assert.equal((await access(fresh)).active, true);
  const results = await Promise.all(Array.from({ length: 20 }, () => reserve(fresh, 'routes')));
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal((await access(fresh)).routesUsed, 10);
  await db.query(`select public.release_mobile_usage($1,'routes',to_char(now() at time zone 'UTC','YYYY-MM'))`, [fresh]);
  assert.equal(await reserve(fresh, 'routes'), true);
  assert.equal(await reserve(fresh, 'routes'), false);
  await db.query(`select public.sync_mobile_subscription($1,'city_all_access',now()+interval '1 month','app_store',now()+interval '1 second')`, [fresh]);
  assert.equal((await access(fresh)).routeLimit, 50);
  assert.equal(await reserve(fresh, 'routes'), true);
});
test('older events cannot overwrite new state; cancellation preserves expiry; refunds revoke', async () => {
  await role('service_role');
  await db.query(`select public.sync_mobile_subscription($1,null,null,null,now()-interval '1 day')`, [fresh]);
  assert.equal((await access(fresh)).active, true);
  await db.query(`select public.sync_mobile_subscription($1,null,null,null,now()+interval '2 seconds')`, [fresh]);
  assert.equal((await access(fresh)).active, false);
  await db.query(`select public.sync_mobile_subscription($1,'city_pass',now()-interval '1 second','app_store',now()+interval '3 seconds')`, [fresh]);
  assert.equal((await access(fresh)).active, false);
  // Billing state can never overwrite the independent permanent founder grant.
  await db.query(`select public.sync_mobile_subscription($1,null,null,null,now())`, [founder]);
  assert.equal((await access(founder)).active, true);
});
test('review access is explicit, expires, and can be revoked; rate limits include founders', async () => {
  await role('service_role');
  await db.query(`insert into public.mobile_access_grants(user_id,kind,note,expires_at) values($1,'reviewer','Disclosed review account',now()+interval '7 days')`, [reviewer]);
  assert.equal((await access(reviewer)).active, true);
  await db.query(`update public.mobile_access_grants set expires_at=now()-interval '1 second' where user_id=$1`, [reviewer]);
  assert.equal((await access(reviewer)).active, false);
  const results = await Promise.all(Array.from({ length: 65 }, () => reserve(founder, 'requests')));
  assert.equal(results.filter(Boolean).length, 60);
});
