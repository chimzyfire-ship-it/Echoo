const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Math,Map});
  return exports;
}
const policy=load('../src/services/notification-policy.ts');
test('notification routes reject external URLs, injected params and unknown screens',()=>{
  for(const target of ['https://evil.test','//evil.test','/auth','/planner?prompt=bad',null,{},'/place/not-an-id']) assert.equal(policy.notificationPath(target),null);
  for(const target of ['/(tabs)','/(tabs)/link-up','/planner','/weekend','/place/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']) assert.equal(policy.notificationPath(target),target);
});
test('invitations stop after three and allow at least two days before the first',()=>{
  for(const value of ['2026-03-07T22:00:00','2026-11-01T18:00:00','2026-09-21T23:59:00']) {
    const now=new Date(value), dates=policy.invitationDates(now);
    assert.equal(dates.length,3);
    assert.ok(dates[0]-now>=48*3600000);
    for(const date of dates) assert.equal(date.getHours(),17);
    assert.ok(dates[1]>dates[0]);assert.ok(dates[2]>dates[1]);
  }
});
test('editorial variants do not repeat on consecutive screen visits',()=>{
  const {nextEditorial,PLANNING_WELCOMES}=load('../src/content/editorial.ts');
  let previous;
  for(let i=0;i<20;i++){ const next=nextEditorial('test',PLANNING_WELCOMES);assert.notEqual(next,previous);previous=next; }
});
test('route voice varies without inventing venue facts or repeating the last opening',()=>{
  const {routeNarration}=load('../../supabase/functions/companion-plan/voice.ts');
  const plan={stops:[{name:'Fixture Café'},{name:'Fixture Gallery'}]};
  const first=routeNarration(plan,'same-request');
  assert.equal(first,routeNarration(plan,'same-request'));
  const next=routeNarration(plan,'same-request',[first],'A relaxed evening sounds lovely.');
  assert.notEqual(first.split('\n')[0],next.split('\n')[0]);
  assert.match(next,/Fixture Café/);assert.match(next,/Fixture Gallery/);assert.doesNotMatch(next,/sounds lovely|verified|open now/);
});

let db;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',M='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',C='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
before(async()=>{
  const {PGlite}=await import('@electric-sql/pglite'); db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');
    create table public.linkup_matches(id uuid primary key,status text,expires_at timestamptz);
    create table public.linkup_match_members(match_id uuid,user_id uuid);
    create table public.linkup_conversations(id uuid primary key,match_id uuid,expires_at timestamptz);
    create table public.linkup_messages(id uuid primary key,conversation_id uuid,sender_id uuid,body text);
    create table public.linkup_blocks(user_a uuid,user_b uuid);
    create table public.planning_sessions(id uuid,user_id uuid,revision integer,response jsonb,expires_at timestamptz);
    create table public.planning_push_devices(token text,user_id uuid,updated_at timestamptz default now());`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/202609210001_app_notifications.sql'),'utf8'));
});
after(async()=>{await db?.close();});
test('notifications are private and preferences cannot target another account',async()=>{
  await db.exec(`set request.jwt.claim.sub='${A}';set role authenticated;`);
  await db.query("select set_notification_preferences('{\"linkup\":true}')");
  assert.equal((await db.query('select * from notification_preferences')).rows.length,1);
  await assert.rejects(db.query("select set_notification_preferences('{\"user_id\":\"other\"}')"),/Invalid preferences/);
  await assert.rejects(db.query('select claim_notification($1)',[M]),/permission denied/);
  await db.exec(`reset role;set request.jwt.claim.sub='${B}';set role authenticated;`);
  assert.equal((await db.query('select * from notification_preferences')).rows.length,0);
  await db.exec('reset role');
});
test('introductions are enqueued once per member, consent-gated and claimed only once',async()=>{
  await db.exec(`insert into linkup_matches values('${M}','pending',now()+interval '10 minutes');
    insert into linkup_match_members values('${M}','${A}'),('${M}','${B}');
    insert into planning_push_devices(token,user_id) values('ExpoPushToken[fixture_a]','${A}');
    update notification_preferences set last_active_at=now()-interval '10 minutes';
    update notification_events set created_at=now()-interval '2 minutes';`);
  const events=(await db.query('select * from notification_events order by user_id')).rows;
  assert.equal(events.length,2);
  const claim=(await db.query('select claim_notification($1) as n',[events[0].id])).rows[0].n;
  assert.equal(claim.userId,A);
  assert.equal((await db.query('select claim_notification($1) as n',[events[0].id])).rows[0].n,null);
  assert.equal((await db.query('select claim_notification($1) as n',[events[1].id])).rows[0].n,null);
});
test('mutual matches and messages use generic lock-screen copy and never notify sender',async()=>{
  await db.exec(`update linkup_matches set status='accepted' where id='${M}';
    insert into linkup_conversations values('${C}','${M}',now()+interval '1 hour');
    insert into linkup_messages values('${C}','${C}','${A}','Private message contents');`);
  assert.equal((await db.query("select * from notification_events where kind='match'")).rows.length,2);
  const message=(await db.query("select * from notification_events where kind='message'")).rows;
  assert.equal(message.length,1);assert.equal(message[0].user_id,B);assert.doesNotMatch(message[0].body,/Private message/);
});
test('blocks suppress pending deliveries and owners alone can acknowledge events',async()=>{
  const event=(await db.query("select * from notification_events where user_id=$1 and kind='match'",[A])).rows[0];
  await db.exec(`insert into linkup_blocks values('${A}','${B}');update notification_events set created_at=now()-interval '2 minutes';`);
  assert.equal((await db.query('select claim_notification($1) as n',[event.id])).rows[0].n,null);
  await db.exec(`set request.jwt.claim.sub='${B}';set role authenticated;`);
  await db.query('select read_notification($1)',[event.id]);
  await db.exec('reset role');
  assert.equal((await db.query('select read_at from notification_events where id=$1',[event.id])).rows[0].read_at,null);
});
test('plan notices only follow completed successful revisions',async()=>{
  await db.exec(`insert into planning_sessions values('${C}','${A}',0,null,now()+interval '24 hours');
    update planning_sessions set response='{"status":"plan_ready"}',revision=1;`);
  assert.equal((await db.query("select * from notification_events where kind='plan_ready'")).rows.length,1);
  await db.exec(`update planning_sessions set response='{"status":"service_error"}',revision=2;`);
  assert.equal((await db.query("select * from notification_events where kind='plan_ready'")).rows.length,1);
});
