const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
let db;
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const PLACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN_REQUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = {
  city: "Toronto",
  stops: [{ id: PLACE, name: "Fixture cafe" }],
};
async function role(name, id = A) {
  await db.exec(
    `reset role; set request.jwt.claim.sub='${id}'; set role ${name};`,
  );
}
before(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${A}'),('${B}');
    create table public.canonical_places(id uuid primary key,location_status text);
    insert into public.canonical_places values('${PLACE}','published');
    create table public.culture_catalog(id uuid primary key,slug text,is_active boolean);
    insert into public.culture_catalog values('${PLACE}','japanese',true);
    create table public.location_entities(id uuid primary key,title text,city text,place_id uuid,created_at timestamptz,starts_at timestamptz,status text,country_code text,admin_area_1 text,entity_type text);
    create table public.culture_entity_tags(location_entity_id uuid,culture_id uuid,review_status text);
    create table public.companion_sessions(id uuid,user_id uuid);
    create table public.companion_memories(user_id uuid);
    create table public.companion_safety_constraints(user_id uuid);
  `);
  for (const name of [
    "202609150001_planning_memory.sql",
    "202609150002_planning_notifications.sql",
    "202609180001_companion_provider_budget.sql",
  ])
    await db.exec(
      readFileSync(
        path.join(__dirname, "../../supabase/migrations", name),
        "utf8",
      ),
    );
});
after(async () => {
  await db?.close();
});

test("provider budgets are atomic, capped, independent, and server-only", async () => {
  for (const r of ["anon", "authenticated"]) {
    await role(r);
    await assert.rejects(db.query("select public.reserve_planning_provider('gemini', 2)"), /permission denied/);
    await assert.rejects(db.query("select * from public.planning_provider_usage"), /permission denied/);
  }
  await role("service_role");
  const reserve = async (provider, cap) => (await db.query("select public.reserve_planning_provider($1,$2) as ok", [provider,cap])).rows[0].ok;
  assert.equal(await reserve("gemini", 2), true);
  assert.equal(await reserve("gemini", 2), true);
  assert.equal(await reserve("gemini", 2), false);
  assert.equal(await reserve("places", 1), true);
  assert.equal(await reserve("places", 1), false);
  assert.equal(await reserve("gemini", 0), false);
  assert.equal(await reserve("invented", 20), false);
});

test("scheduler functions and device tokens are inaccessible to ordinary users", async () => {
  for (const r of ["anon", "authenticated"]) {
    await role(r);
    await assert.rejects(
      db.query(`select * from public.planning_push_devices`),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select public.planning_notification_candidates($1,'weekend')`, [
        A,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        `select public.reserve_planning_notification($1,'test','weekend','{}')`,
        [A],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select public.store_planning_result($1,$2,$3)`, [
        A,
        PLAN_REQUEST,
        JSON.stringify(snapshot),
      ]),
      /permission denied/,
    );
  }
});
test("consent gates server persistence; RLS and membership gate feedback", async () => {
  await role("service_role");
  assert.equal(
    (
      await db.query(`select public.store_planning_result($1,$2,$3) as id`, [
        A,
        PLAN_REQUEST,
        JSON.stringify(snapshot),
      ])
    ).rows[0].id,
    null,
  );
  await role("authenticated");
  await db.query(
    `select public.set_planning_preferences(true,false,'Toronto','America/Toronto',array['japanese'])`,
  );
  await assert.rejects(
    db.query(
      `select public.set_planning_preferences(true,false,'Toronto','America/Toronto',array['invented'])`,
    ),
    /Invalid culture/,
  );
  await role("service_role");
  const id = (
    await db.query(`select public.store_planning_result($1,$2,$3) as id`, [
      A,
      PLAN_REQUEST,
      JSON.stringify(snapshot),
    ])
  ).rows[0].id;
  assert.ok(id);
  const retry = (
    await db.query(`select public.store_planning_result($1,$2,$3) as id`, [
      A,
      PLAN_REQUEST,
      JSON.stringify(snapshot),
    ])
  ).rows[0].id;
  assert.equal(retry, id);
  await role("authenticated", B);
  assert.equal(
    (await db.query(`select * from public.planning_saved_plans`)).rows.length,
    0,
  );
  await assert.rejects(
    db.query(`select public.record_planning_feedback($1,$2,'liked')`, [
      id,
      PLACE,
    ]),
    /Enable planning memory/,
  );
  await role("authenticated", A);
  await assert.rejects(
    db.query(`select public.record_planning_feedback($1,$2,'liked')`, [id, B]),
    /does not belong/,
  );
  await db.query(`select public.record_planning_feedback($1,$2,'shown')`, [
    id,
    PLACE,
  ]);
  await db.query(`select public.record_planning_feedback($1,$2,'shown')`, [
    id,
    PLACE,
  ]);
  assert.equal(
    (
      await db.query(
        `select * from public.planning_feedback where action='shown'`,
      )
    ).rows.length,
    1,
  );
  await db.query(`select public.record_planning_feedback($1,$2,'disliked')`, [
    id,
    PLACE,
  ]);
  await db.query(`select public.record_planning_feedback($1,$2,'liked')`, [
    id,
    PLACE,
  ]);
  assert.equal(
    (
      await db.query(
        `select * from public.planning_feedback where action='disliked'`,
      )
    ).rows.length,
    0,
  );
});
test("sessions reject stale edits, reuse retries, and never disclose another user’s context", async () => {
  const request = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await role("authenticated", A);
  const turn = (
    await db.query(`select public.begin_planning_turn(null,0,$1) as result`, [
      request,
    ])
  ).rows[0].result;
  assert.equal(turn.revision, 0);
  await assert.rejects(
    db.query(`select public.begin_planning_turn($1,0,$2)`, [
      turn.sessionId,
      PLAN_REQUEST,
    ]),
    /TURN_BUSY/,
  );
  await role("authenticated", B);
  await assert.rejects(
    db.query(`select public.begin_planning_turn($1,0,$2)`, [
      turn.sessionId,
      PLAN_REQUEST,
    ]),
    /SESSION_EXPIRED/,
  );
  await role("service_role");
  const response = {
    sessionId: turn.sessionId,
    revision: 1,
    message: "A real plan",
  };
  await db.query(`select public.finish_planning_turn($1,$2,$3,'{}',$4)`, [
    A,
    turn.sessionId,
    request,
    JSON.stringify(response),
  ]);
  await role("authenticated", A);
  const cached = (
    await db.query(`select public.begin_planning_turn($1,0,$2) as result`, [
      turn.sessionId,
      request,
    ])
  ).rows[0].result;
  assert.deepEqual(cached.cached, response);
  await assert.rejects(
    db.query(`select public.begin_planning_turn($1,0,$2)`, [
      turn.sessionId,
      PLAN_REQUEST,
    ]),
    /REVISION_CONFLICT/,
  );
});
test("notification reservation is idempotent, shares a global cap, and fails closed without consent", async () => {
  await role("authenticated", A);
  await db.query(
    `select public.register_planning_device('ExpoPushToken[abcdefghijklmnop12345678]')`,
  );
  // Choose a real timezone currently inside the permitted window. This is a
  // database contract test, not a claim to test wall-clock cron timing.
  await db.exec("reset role");
  const tz = (
    await db.query(
      `select name from pg_timezone_names where extract(hour from now() at time zone name) between 16 and 19 limit 1`,
    )
  ).rows[0].name;
  await role("authenticated", A);
  await db.query(
    `select public.set_planning_preferences(true,true,'Toronto',$1,array['japanese'])`,
    [tz],
  );
  await role("service_role");
  const args = [
    A,
    "culture:test",
    "culture",
    JSON.stringify({ body: "New to Echoo" }),
  ];
  const first = (
    await db.query(
      `select public.reserve_planning_notification($1,$2,$3,$4) as value`,
      args,
    )
  ).rows[0].value;
  assert.ok(first?.id);
  assert.equal(
    (
      await db.query(
        `select public.reserve_planning_notification($1,$2,$3,$4) as value`,
        args,
      )
    ).rows[0].value,
    null,
  );
  await db.query(
    `update public.planning_notification_outbox set created_at=now()-interval '2 days',kind='weekend' where user_id=$1`,
    [A],
  );
  await db.query(
    `insert into public.planning_notification_outbox(user_id,campaign,kind,status,payload) values($1,'other1','weekend','unknown','{}'),($1,'other2','weekend','reserved','{}')`,
    [A],
  );
  assert.equal(
    (
      await db.query(
        `select public.reserve_planning_notification($1,'culture:second','culture','{}') as value`,
        [A],
      )
    ).rows[0].value,
    null,
  );
  await role("authenticated", A);
  await db.query(
    `select public.set_planning_preferences(true,false,'Toronto',$1,'{}')`,
    [tz],
  );
  await role("service_role");
  assert.equal(
    (
      await db.query(
        `select public.reserve_planning_notification($1,'culture:third','culture','{}') as value`,
        [A],
      )
    ).rows[0].value,
    null,
  );
});
test("deletion removes history and sessions and prevents late personalization writes", async () => {
  await role("authenticated", A);
  await db.query("select public.delete_planning_history()");
  assert.equal(
    (await db.query("select * from public.planning_saved_plans")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.planning_feedback")).rows.length,
    0,
  );
  await role("service_role");
  assert.equal(
    (
      await db.query(
        "select * from public.planning_sessions where user_id=$1",
        [A],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(`select public.store_planning_result($1,$2,$3) as id`, [
        A,
        PLAN_REQUEST,
        JSON.stringify(snapshot),
      ])
    ).rows[0].id,
    null,
  );
});

test("repeated feedback does not inflate metrics; restoring a hidden place keeps its saved signal", async () => {
  await role("authenticated", A);
  await db.query(
    "select public.set_planning_preferences(true,false,'Toronto','America/Toronto','{}')",
  );
  await role("service_role");
  const id = (
    await db.query("select public.store_planning_result($1,$2,$3) as id", [
      A,
      PLAN_REQUEST,
      JSON.stringify(snapshot),
    ])
  ).rows[0].id;
  const before = (
    await db.query(
      "select count(*)::int as count from public.planning_metrics where user_id=$1 and kind='feedback'",
      [A],
    )
  ).rows[0].count;
  await role("authenticated", A);
  for (let i = 0; i < 3; i++)
    await db.query("select public.record_planning_feedback($1,$2,'liked')", [
      id,
      PLACE,
    ]);
  await role("service_role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.planning_metrics where user_id=$1 and kind='feedback'",
        [A],
      )
    ).rows[0].count,
    before + 1,
  );
  await role("authenticated", A);
  await db.query("select public.record_planning_feedback($1,$2,'saved')", [
    id,
    PLACE,
  ]);
  await db.query("select public.record_planning_feedback($1,$2,'disliked')", [
    id,
    PLACE,
  ]);
  await db.query("select public.remove_planning_feedback($1)", [PLACE]);
  assert.equal(
    (
      await db.query(
        "select * from public.planning_feedback where action='disliked'",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select * from public.planning_feedback where action='saved'",
      )
    ).rows.length,
    1,
  );
});

test("notification opens require ownership and count once", async () => {
  await role("service_role");
  const id = (
    await db.query(
      "select id from public.planning_notification_outbox where user_id=$1 limit 1",
      [A],
    )
  ).rows[0].id;
  await role("authenticated", B);
  await db.query("select public.record_planning_notification_open($1)", [id]);
  await role("service_role");
  assert.equal(
    (
      await db.query(
        "select opened_at from public.planning_notification_outbox where id=$1",
        [id],
      )
    ).rows[0].opened_at,
    null,
  );
  await role("authenticated", A);
  await db.query("select public.record_planning_notification_open($1)", [id]);
  await db.query("select public.record_planning_notification_open($1)", [id]);
  await role("service_role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.planning_metrics where kind='push_open' and user_id=$1",
        [A],
      )
    ).rows[0].count,
    1,
  );
});
