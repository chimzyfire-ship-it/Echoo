const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
let db;
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${A}'),('${B}'),('${C}');
    create table public.user_onboarding_profiles(user_id uuid primary key references auth.users(id), completed_at timestamptz);
    insert into public.user_onboarding_profiles values('${A}',now()),('${B}',null);
  `);
  await db.exec(readFileSync(path.join(__dirname, '../../supabase/migrations/202609230001_first_use_walkthrough.sql'), 'utf8'));
});
after(async () => db?.close());
async function asUser(id) {
  await db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
}
async function claim() { return (await db.query('select public.claim_first_use_walkthrough() as show')).rows[0].show; }
test('existing completed accounts and profile edits never enrol', async () => {
  await db.exec(`update public.user_onboarding_profiles set completed_at=now() where user_id='${A}'`);
  await asUser(A);
  assert.equal(await claim(), false);
  await db.exec('reset role');
});
test('incomplete accounts cannot claim; successful completion enrols atomically', async () => {
  await asUser(B); assert.equal(await claim(), false);
  await db.exec(`reset role; update public.user_onboarding_profiles set completed_at=now() where user_id='${B}';`);
  await asUser(A); assert.equal(await claim(), false, 'cannot claim another account');
  await asUser(B);
  assert.deepEqual(await Promise.all([claim(), claim(), claim()]), [true, false, false]);
  await db.exec(`reset role; update public.user_onboarding_profiles set completed_at=now() where user_id='${B}';`);
  await asUser(B); assert.equal(await claim(), false, 'later profile save must not replay');
  await db.exec('reset role');
});
test('inserted completed profiles get one claim and direct state reset is forbidden', async () => {
  await db.exec(`insert into public.user_onboarding_profiles values('${C}',now())`);
  await asUser(C);
  assert.equal(await claim(), true);
  await assert.rejects(db.query('update public.first_use_walkthroughs set started_at=null'), /permission denied/);
  assert.equal(await claim(), false);
  await db.exec('reset role; set role anon');
  await assert.rejects(claim(), /permission denied/);
  await db.exec('reset role');
});
