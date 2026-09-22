const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(__dirname, file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      source,
      {
        exports,
        Request,
        Response,
        URL,
        Date,
        AbortSignal,
        console,
        Deno: { env: { get: () => undefined }, serve: () => {} },
        require: (name) =>
          Object.hasOwn(overrides, name)
            ? overrides[name]
            : load(path.resolve(path.dirname(file), name)),
        ...globals,
      },
      { filename: file },
    );
    return exports;
  }
  return load;
}
const load = loader();
const rules = load("../../supabase/functions/_shared/planning-intent.ts");
const intents = load("../../supabase/functions/companion-plan/intent.ts");
const planner = load("../../supabase/functions/quick-plan/planner.ts");
const memory = load("../../supabase/functions/_shared/planning-memory.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("specific cravings, unfamiliar cuisines and quoted venue names survive search interpretation", () => {
  for (const [query, expected] of [
    ["I want sushi near me", "sushi"],
    ["Find me Ethiopian food", "ethiopian"],
    ['Show me "Sushi Cafe North"', "Sushi Cafe North"],
    ["Find me Georgian near me", "Georgian"],
    ["Coffee then a park", "cafe"],
    ["sushi, no clubs", "sushi"],
  ])
    assert.equal(rules.specificSearchTerm(query), expected);
});

test("ordered requests retain their categories, budgets and travel mode through edits", () => {
  const first = intents.localCompanionIntent(
    "Sushi then a park, under $80 total for two, walking only tonight",
  );
  assert.deepEqual(plain(first.slotQueries), ["sushi", "park"]);
  assert.equal(first.maxBudget, 80);
  assert.equal(first.partySize, 2);
  assert.equal(first.budgetScope, "total");
  const edit = intents.localCompanionIntent(
    "Replace the second with a museum",
    first,
  );
  assert.deepEqual(plain(edit.slotQueries), ["sushi", "museum"]);
  assert.equal(edit.replaceIndex, 1);
  assert.equal(edit.maxBudget, 80);
  assert.equal(edit.travelExplicit, true);
  assert.equal(edit.day, "tonight");
  const next = intents.localCompanionIntent("Try another plan", edit);
  assert.deepEqual(plain(next.slotQueries), ["sushi", "museum"]);
  assert.equal(next.maxBudget, 80);
});

test("keeping the first stop is not interpreted as replacing it", () => {
  const original = intents.localCompanionIntent("Sushi then coffee");
  assert.equal(
    intents.localCompanionIntent(
      "Keep the first, change the second to a park",
      original,
    ).replaceIndex,
    1,
  );
  assert.equal(
    intents.localCompanionIntent("Keep the first", original).replaceIndex,
    null,
  );
});

test("ambiguous group budgets clarify without losing the request", () => {
  const first = intents.localCompanionIntent(
    "Sushi under $80 for a group of four",
  );
  assert.equal(first.partySize, 4);
  assert.ok(first.blockers.some((x) => x.includes("per person")));
  const clarified = intents.localCompanionIntent("Per person", first);
  assert.equal(clarified.maxBudget, 80);
  assert.equal(clarified.budgetScope, "person");
  assert.equal(clarified.blockers.length, 0);
  assert.deepEqual(plain(clarified.slotQueries), ["sushi"]);
});

test("unsupported hard requirements are surfaced; exclusions persist across edits", () => {
  for (const query of [
    "Sushi, gluten-free",
    "Coffee, wheelchair accessible",
    "Five stops tonight",
    "Sushi at 9 pm",
    "Get me home by 10 pm",
  ]) {
    assert.ok(intents.localCompanionIntent(query).blockers.length, query);
  }
  const original = intents.localCompanionIntent(
    "A date night, no clubs or bars",
  );
  assert.ok(original.excludedTerms.includes("club"));
  assert.ok(
    intents
      .localCompanionIntent("Try another plan", original)
      .excludedTerms.includes("club"),
  );
});

test("malformed model output fails safely and specific cuisines cannot be widened by a model", async () => {
  for (const value of [
    null,
    {},
    { searchTerms: [] },
    { searchTerms: ["https://made-up.test"] },
    { searchTerms: ["sushi", 9] },
  ])
    assert.equal(intents.validateIntentDraft(value), null);
  const model = loader(
    {},
    {
      Deno: {
        env: {
          get: (key) => (key === "GEMINI_API_KEY" ? "test-only" : undefined),
        },
      },
      fetch: async () =>
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: JSON.stringify({ searchTerms: ["restaurant", "park"] }) },
                ],
              },
            },
          ],
        }),
    },
  )("../../supabase/functions/companion-plan/intent.ts");
  const result = await model.parseCompanionIntent(
    "Sushi then somewhere to sit and reflect",
  );
  assert.equal(result.intent.slotQueries[0], "sushi");
  const offline = loader(
    {},
    {
      Deno: { env: { get: () => "test-only" } },
      fetch: async () => {
        throw new Error("offline");
      },
    },
  )("../../supabase/functions/companion-plan/intent.ts");
  assert.equal(
    (await offline.parseCompanionIntent("Sushi then somewhere to sit and reflect")).parser,
    "rules",
  );
});

test("future starts use the city timezone across daylight saving changes", () => {
  assert.equal(
    intents
      .planningStart(
        "tomorrow",
        "America/Toronto",
        new Date("2026-03-07T18:00:00Z"),
      )
      .toISOString(),
    "2026-03-08T22:00:00.000Z",
  );
  assert.equal(
    intents
      .planningStart(
        "tomorrow",
        "America/Toronto",
        new Date("2026-10-31T18:00:00Z"),
      )
      .toISOString(),
    "2026-11-01T23:00:00.000Z",
  );
});

test("hours must cover the entire visit, including overnight intervals and stale records", () => {
  const now = new Date("2026-06-15T23:30:00Z"); // Monday 19:30 Toronto
  const row = { day_of_week: 1, opens_at: "10:00", closes_at: "19:35" };
  assert.equal(planner.openAt([row], "America/Toronto", now).open, true);
  assert.equal(
    planner.openForVisit([row], "America/Toronto", now, 65).open,
    false,
  );
  assert.equal(
    planner.openForVisit(
      [{ ...row, opens_at: "18:00", closes_at: "02:00" }],
      "America/Toronto",
      now,
      90,
    ).open,
    true,
  );
  assert.equal(
    planner.openAt(
      [{ ...row, updated_at: "2025-01-01" }],
      "America/Toronto",
      now,
    ).known,
    false,
  );
});

test("route provider errors and missing legs cannot masquerade as verified walking", async () => {
  const places = [
    { id: "a", latitude: 43.6, longitude: -79.3 },
    { id: "b", latitude: 43.61, longitude: -79.31 },
  ];
  const matrix = loader(
    {},
    {
      Deno: { env: { get: () => "test-only" } },
      fetch: async () =>
        Response.json([
          {
            originIndex: 0,
            destinationIndex: 1,
            condition: "ROUTE_EXISTS",
            duration: "601s",
            status: {},
          },
          {
            originIndex: 1,
            destinationIndex: 0,
            condition: "ROUTE_NOT_FOUND",
            duration: "1s",
          },
        ]),
    },
  )("../../supabase/functions/_shared/route-matrix.ts");
  const result = await matrix.loadRouteMatrix(places, "walk", new Date());
  assert.equal(result["a:b"], 11);
  assert.equal(result["b:a"], undefined);
  const unavailable = loader(
    {},
    {
      Deno: { env: { get: () => "test-only" } },
      fetch: async () => new Response("", { status: 503 }),
    },
  )("../../supabase/functions/_shared/route-matrix.ts");
  assert.equal(
    await unavailable.loadRouteMatrix(places, "walk", new Date()),
    null,
  );
});

test("callbacks describe only recorded likes or saves and respect city, consent and exclusions", () => {
  const plan = {
    city: "Toronto",
    stops: [{ id: "a", name: "Real Cafe", category: "cafe" }],
  };
  const state = {
    ...memory.emptyPlanningMemory(),
    enabled: true,
    actions: [
      {
        place_id: "a",
        action: "saved",
        created_at: new Date().toISOString(),
        plan,
      },
    ],
  };
  assert.match(memory.factualCallback(state, plan), /^You saved Real Cafe/);
  assert.equal(
    memory.factualCallback({ ...state, enabled: false }, plan),
    null,
  );
  assert.equal(
    memory.factualCallback({ ...state, excludedIds: ["a"] }, plan),
    null,
  );
  assert.equal(
    memory.factualCallback(state, { ...plan, city: "Ottawa" }),
    null,
  );
});

const USER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
function companionFixture(previous, quickStatus = 200) {
  const calls = [],
    states = [];
  const cities = ["Toronto", "Ottawa"].map((name) => ({
    name,
    timezone: "America/Toronto",
    coverageLevel: "municipality",
  }));
  const originalPlan = {
    anchorId: "first",
    stopCount: 2,
    requestedStopCount: 2,
    stops: [{ id: "first" }, { id: "second" }],
    budgetEstimate: { max: 80, unknownCount: 0 },
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({ data: null }),
      insert: async () => ({}),
    }),
    rpc: async (name, args) => {
      if (name === "begin_planning_turn")
        return {
          data: { sessionId: REQUEST, revision: 1, state: previous || {} },
        };
      if (name === "finish_planning_turn") {
        states.push(args.p_state);
        return { data: true };
      }
      if (name === "search_planning_places")
        return { data: [{ id: "candidate" }, { id: "candidate2" }] };
      throw new Error(name);
    },
  };
  const handler = loader({
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
    "../_shared/location.ts": {
      CORS_HEADERS: {},
      getSupabaseAdmin: () => db,
      ONTARIO_MUNICIPALITIES: cities,
      normalizeCityName: (name) => cities.find((c) => c.name === name),
      jsonResponse: (body, status = 200) => Response.json(body, { status }),
    },
    "../_shared/planning-memory.ts": {
      readPlanningMemory: async () => memory.emptyPlanningMemory(),
      factualCallback: () => null,
    },
    "../quick-plan/service.ts": {
      handleQuickPlan: async (request, options) => {
        calls.push({ body: await request.json(), options });
        return Response.json(
          quickStatus === 200
            ? { plan: originalPlan }
            : { error: "No feasible route" },
          { status: quickStatus },
        );
      },
    },
  })("../../supabase/functions/companion-plan/index.ts").handleCompanion;
  return {
    calls,
    states,
    originalPlan,
    ask: async (query) =>
      (
        await handler(
          new Request("https://test.invalid", {
            method: "POST",
            headers: { authorization: "Bearer test" },
            body: JSON.stringify({
              query,
              city: "Toronto",
              requestId: REQUEST,
              sessionId: REQUEST,
              revision: 1,
            }),
          }),
        )
      ).json(),
  };
}

test("follow-up planning uses the conversation city and keeps untouched stop IDs", async () => {
  const previous = {
    city: "Ottawa",
    intent: intents.localCompanionIntent("Sushi then a park"),
    plan: { anchorId: "first", stops: [{ id: "first" }, { id: "second" }] },
  };
  const f = companionFixture(previous);
  const response = await f.ask("Replace the second with a museum");
  assert.equal(response.preferences.city, "Ottawa");
  assert.equal(f.calls[0].body.anchor.city, "Ottawa");
  assert.deepEqual(plain(f.calls[0].options.lockedStops), [
    { id: "first", index: 0 },
  ]);
  assert.deepEqual(plain(f.calls[0].body.recentPlaceIds), ["second"]);
});

test("a failed edit retains both the last valid plan and its matching intent", async () => {
  const previous = {
    city: "Toronto",
    intent: intents.localCompanionIntent("Sushi then a park"),
    plan: { anchorId: "first", stops: [{ id: "first" }, { id: "second" }] },
  };
  const f = companionFixture(previous, 422);
  assert.equal(
    (await f.ask("Replace the second with a museum")).status,
    "no_match",
  );
  assert.deepEqual(plain(f.states[0].intent), plain(previous.intent));
  assert.deepEqual(plain(f.states[0].plan), plain(previous.plan));
  assert.deepEqual(plain(f.states[0].pendingIntent.slotQueries), ["sushi", "museum"]);
  assert.equal(f.states[0].history[0].query, "Replace the second with a museum");
});

test("cheaper edits lower the maximum estimate instead of changing only the label", async () => {
  const f = companionFixture({
    city: "Toronto",
    intent: intents.localCompanionIntent("Sushi then a park"),
    plan: {
      anchorId: "first",
      stops: [{ id: "first" }, { id: "second" }],
      budgetEstimate: { max: 80, unknownCount: 0 },
    },
  });
  await f.ask("Try a lower budget");
  assert.equal(f.calls[0].options.constraints.maxPerPerson, 79);
});

test("infeasible first candidates allow a bounded search of other real anchors", async () => {
  const f = companionFixture(null, 422);
  assert.equal((await f.ask("Sushi")).status, "no_match");
  assert.deepEqual(
    f.calls.map((c) => c.body.anchor.id),
    ["candidate", "candidate2"],
  );
});


test('explicit multi-stop requests skip the model and retain order even when a later stop names a cuisine', async () => {
  let called=false;
  const parser=loader({}, {Deno:{env:{get:()=> 'test-only'}},fetch:async()=>{called=true;throw new Error('must not call');}})('../../supabase/functions/companion-plan/intent.ts');
  const result=await parser.parseCompanionIntent('Coffee then sushi tonight');
  assert.deepEqual(plain(result.intent.slotQueries),['cafe','sushi']);
  assert.equal(called,false);
});

test('native companion validation rejects duplicate or incomplete route cards', () => {
  const api=loader({'@/src/services/supabase':{echooConfig:{}},'@/src/services/location':{}})('../src/services/api.ts');
  const client=loader({'expo-crypto':{},'@/src/services/api':api,'@/src/services/supabase':{},'@/src/services/outing':{}})('../src/services/planning.ts');
  const stop={id:'a',name:'Real cafe',latitude:43.6,longitude:-79.3};
  const response={version:1,sessionId:REQUEST,revision:1,status:'plan_ready',message:'Your route',plan:{anchorId:'a',stopCount:2,requestedStopCount:2,stops:[stop,{...stop,id:'b'}]}};
  assert.equal(client.validateCompanionResponse(response).plan.stops.length,2);
  assert.throws(()=>client.validateCompanionResponse({...response,plan:{...response.plan,stops:[stop,stop]}}),/incomplete/);
  assert.throws(()=>client.validateCompanionResponse({...response,plan:{...response.plan,stops:[stop,{...stop,id:'b',latitude:NaN}]}}),/incomplete/);
});

test('notification scheduler rejects ordinary requests before touching data; bad provider tickets fail', async () => {
  const notifications=loader({'../_shared/location.ts':{getSupabaseAdmin:()=>{throw new Error('must not access');},jsonResponse:(body,status=200)=>Response.json(body,{status})}}, {Deno:{env:{get:()=> 'private-test-secret'},serve:()=>{}}})('../../supabase/functions/planning-notifications/index.ts');
  const response=await notifications.notificationHandler(new Request('https://test.invalid',{method:'POST'}));
  assert.equal(response.status,401);
  assert.equal(notifications.pushTicket({data:{status:'ok',id:'ticket'}}).status,'accepted');
  assert.equal(notifications.pushTicket({data:{status:'error',details:{error:'DeviceNotRegistered'}}}).retire,true);
  assert.equal(notifications.pushTicket({}).status,'failed');
});


test('generic categories use indexed filters while specific cuisines remain text searches',()=>{
  assert.deepEqual(plain(rules.planningSearchFilter('park')),{p_query:null,p_category:'park'});
  assert.deepEqual(plain(rules.planningSearchFilter('sushi')),{p_query:'sushi',p_category:null});
  assert.deepEqual(plain(rules.planningSearchFilter('Park Cafe North')),{p_query:'Park Cafe North',p_category:null});
});


test("activity queries use searchable inventory terms without turning activities into food", () => {
  for (const [query, term] of [
    ["bowling alleys", "bowling"], ["escape rooms", "escape"],
    ["board game cafes", "board game"], ["indoor rock climbing gyms", "climbing"],
    ["pottery studios classes", "pottery"], ["ski resorts", "ski"],
    ["ice skating rinks", "skating"], ["craft breweries taprooms", "brewery"],
    ["day spas and saunas", "spa"], ["hiking trails", "trail"],
    ["dessert shops", "dessert"], ["brunch restaurants", "brunch"],
  ]) assert.equal(rules.specificSearchTerm(query), term, query);
});

test("provider errors distinguish billing, access, quota and unknown failures without raw details", async () => {
  const { providerFailure } = load("../../supabase/functions/_shared/provider-status.ts");
  for (const [status, body, expected] of [
    [403, {error:{details:[{reason:"BILLING_DISABLED",metadata:{secret:"never-return"}}]}}, "billing_disabled"],
    [403, {error:{details:[{reason:"SERVICE_DISABLED"}]}}, "api_disabled"],
    [403, {error:{message:"Key rejected"}}, "key_rejected"],
    [429, {}, "quota_exceeded"], [500, {}, "unavailable"],
  ]) assert.equal(await providerFailure(new Response(JSON.stringify(body), {status})), expected);
  assert.equal(await providerFailure(new Response("not json", {status:502})), "unavailable");
});
