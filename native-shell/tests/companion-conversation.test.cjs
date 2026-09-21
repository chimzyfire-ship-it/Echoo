const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function loadModule(entry, overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, { exports, console, Request, Response, AbortSignal, URL, Date,
      Deno: { env: { get: () => undefined }, serve() {} },
      require: (name) => Object.hasOwn(overrides, name) ? overrides[name] : load(path.resolve(path.dirname(file), name)), ...globals });
    return exports;
  }
  return load(path.join(__dirname, "../../supabase/functions/companion-plan", entry));
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const draft = (patch = {}) => ({
  action: "plan", message: "A little coffee and fresh air sounds good.", title: "An easy afternoon", city: "Toronto",
  searchTerms: ["cafe", "park"], mood: "chill", budgetStyle: "balanced", maxBudget: null,
  budgetScope: "unknown", partySize: 1, travelMode: "walk", travelExplicit: false,
  day: "now", openOnly: false, replaceIndex: null, excludedTerms: [], context: ["A relaxed afternoon"],
  suggestions: ["Something indoors instead", "Just the coffee"], ...patch,
});
const brain = loadModule("conversation.ts");
test("contextual edits preserve the first slot and infer the changed position", () => {
  const previous = brain.validateConversation(draft({ maxBudget: 80, budgetScope: "total", partySize: 2, excludedTerms: ["bar"] }), "Coffee then a park for two under $80 total, no bars").intent;
  const edit = brain.validateConversation(draft({ action: "edit", searchTerms: ["cafe", "museum"], maxBudget: 80, budgetScope: "total", partySize: 2, excludedTerms: ["bar"] }), "Make the second one indoors", previous);
  assert.equal(edit.intent.replaceIndex, 1);
  assert.deepEqual(plain(edit.intent.slotQueries), ["cafe", "museum"]);
  assert.equal(edit.intent.maxBudget, 80);
  assert.deepEqual(plain(edit.intent.excludedTerms), ["bar"]);
});
test("schema validation rejects invented action shapes and invalid constraints", () => {
  for (const bad of [null, {}, draft({ action: "book" }), draft({ searchTerms: ["https://fake.test"] }), draft({ partySize: 0 }), draft({ maxBudget: "20" }), draft({ maxBudget: -1 }), draft({ replaceIndex: 8 }), draft({ travelMode: "teleport" }), draft({ openOnly: "yes" })]) {
    assert.equal(brain.validateConversation(bad, "coffee"), null);
  }
});
test("hard requirements and ambiguous money remain visible despite model optimism", () => {
  const result = brain.validateConversation(draft({ partySize: 4, maxBudget: 80 }), "Dinner under $80 with friends, gluten-free");
  assert.ok(result.intent.blockers.some((b) => b.includes("each of you")));
  assert.ok(result.intent.blockers.some((b) => b.includes("dietary")));
});
test("the model cannot invent open-now filters and indoor requests use a real category", () => {
  const simple = brain.validateConversation(draft({ searchTerms:["sushi"],openOnly:true,maxBudget:20 }), "I need some sushi");
  assert.equal(simple.intent.openOnly,false);
  assert.equal(simple.intent.maxBudget,null);
  const previous = brain.validateConversation(draft({day:"tomorrow",partySize:2,excludedTerms:["bars"]}),"Coffee then a park tomorrow for two, no bars").intent;
  const edit = brain.validateConversation(draft({action:"edit",searchTerms:["cafe","indoors"],day:"now",excludedTerms:[]}),"Make the second one indoors",previous);
  assert.equal(edit.intent.day,"tomorrow");
  assert.equal(edit.intent.partySize,2);
  assert.deepEqual(plain(edit.intent.slotQueries),["cafe","museum"]);
  assert.deepEqual(plain(edit.intent.excludedTerms),["bar"]);
});
test("conversational replies may omit searches without losing current preferences", () => {
  const previous = brain.validateConversation(draft(),"coffee then a park").intent;
  const reply = brain.validateConversation(draft({action:"reply",searchTerms:[],message:"Hey, what are you in the mood for?"}),"Hey echoo",previous);
  assert.equal(reply.action,"reply");
  assert.deepEqual(plain(reply.intent.slotQueries),["cafe","park"]);
});
test("narration rejects unsupported verification claims and always uses real stop names", async () => {
  const narrator = loadModule("conversation.ts", {"./model.ts":{modelJson:async()=>({message:"An inspected spot is ready for you, a comfortable walk away."})}});
  const message = await narrator.describePlan({},"sushi",{context:[],intent:{slotQueries:["sushi"]}},{stops:[{name:"Real Sushi"}]},[]);
  assert.match(message,/Real Sushi/);
  assert.doesNotMatch(message,/inspected|comfortable|ready/);
});
test("model gets bounded server-owned conversation and grounded current plan facts", async () => {
  let input;
  const model = loadModule("conversation.ts", { "./model.ts": { modelJson: async (_db,_system,value) => { input=value; return draft({ action: "reply", message: "I don’t have confirmed opening hours for that café." }); } } });
  const state = { history: Array.from({length:15}, (_,i) => ({ query:`turn ${i}`, response:{message:`answer ${i}`} })),
    plan: { city:"Toronto", stops:[{id:"real-id",name:"Real Cafe",availability:"unverified"}] }, context:["No bars"] };
  const response = await model.understandConversation({}, "Is it open?", "Toronto", state);
  assert.equal(response.action, "reply");
  assert.equal(input.history.length,10);
  assert.equal(input.history[0].user,"turn 5");
  assert.equal(input.currentPlan.stops[0].name,"Real Cafe");
  assert.equal(input.currentPlan.stops[0].availability,"unverified");
});
test("provider failures retain deterministic planning and greeting does not trigger a random route", async () => {
  const unavailable = loadModule("conversation.ts", { "./model.ts": { modelJson: async () => null } });
  const hello = await unavailable.understandConversation({},"hello","Toronto",{});
  assert.equal(hello.action,"reply");
  const sushi = await unavailable.understandConversation({},"I need some sushi","Toronto",{});
  assert.equal(sushi.action,"plan");
  assert.equal(sushi.parser,"rules");
  assert.deepEqual(plain(sushi.intent.slotQueries),["sushi"]);
  const warmDrink = await unavailable.understandConversation({},"I would like a warm drink somewhere I can unwind","Toronto",{});
  assert.deepEqual(plain(warmDrink.intent.slotQueries),["cafe"]);
});
test("quota failures never spend a provider call and malformed model responses fail closed", async () => {
  let calls=0;
  const model = loadModule("model.ts",{}, {Deno:{env:{get:(key)=>key === "GEMINI_API_KEY" ? "test-key" : undefined}},fetch:async()=>{calls++;return Response.json({ candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:'{"action":"plan"}'}]}}]});}});
  const blocked = {rpc:async()=>({data:false})};
  assert.equal(await model.modelJson(blocked,"system",{},{}),null);
  assert.equal(calls,0);
  const allowed = {rpc:async()=>({data:true})};
  assert.equal(await model.modelJson(allowed,"system",{},{}),null);
  assert.equal(calls,1);
});
test("live search never accepts a closed, wrong-city, or non-Ontario venue", () => {
  const search = loadModule("search.ts", { "../_shared/location.ts": { normalizeCityName:(name)=>name === "Toronto" ? {name} : null }, "../quick-plan/service.ts":{} });
  const venue = {id:"provider-id",displayName:{text:"Real cafe"},location:{latitude:43.65,longitude:-79.38},businessStatus:"OPERATIONAL",addressComponents:[
    {types:["country"],shortText:"CA"},{types:["administrative_area_level_1"],shortText:"ON"},{types:["locality"],longText:"Toronto"},
  ]};
  assert.equal(search.isPlaceInCity(venue,"Toronto"),true);
  assert.equal(search.isPlaceInCity({...venue,businessStatus:"CLOSED_PERMANENTLY"},"Toronto"),false);
  assert.equal(search.isPlaceInCity(venue,"Ottawa"),false);
  assert.equal(search.isPlaceInCity({...venue,location:{latitude:null,longitude:10}},"Toronto"),false);
  assert.equal(search.isPlaceInCity({...venue,addressComponents:[]},"Toronto"),false);
});
test("live Places outage preserves stored candidates and sets a shared cooldown", async () => {
  const writes=[];
  const search = loadModule("search.ts", {
    "../_shared/location.ts": { readLocationCache:async()=>null, writeLocationCache:async(...args)=>writes.push(args),sha256Hex:async()=>"hash",normalizeCityName:()=>({name:"Toronto",lat:43.6,lng:-79.3}) },
    "../quick-plan/service.ts": {}, "./model.ts":{reserveProvider:async()=>true},
  }, {Deno:{env:{get:()=>"key"}},fetch:async()=>new Response("billing unavailable",{status:403})});
  const result=await search.searchPlanningPlaces({rpc:async()=>({data:[{id:"real",name:"Real sushi",category:"restaurant"}]})},"sushi","Toronto");
  assert.equal(result.places[0].name,"Real sushi");
  assert.equal(result.liveUnavailable,true);
  assert.equal(writes[0][1],"planning:places:unavailable");
  assert.equal(writes[0][3],300);
});


test("specific model understanding survives generic category words across unfamiliar activities", () => {
  for (const [query, term] of [
    ["I want a trampoline park", "trampoline park"],
    ["Find a cat cafe", "cat cafe"],
    ["A ceramics cafe would be nice", "ceramics cafe"],
    ["I want a botanical garden", "botanical garden"],
    ["Find a VR arcade", "virtual reality arcade"],
    ["Je voudrais faire du karting", "go karting"],
  ]) {
    const result = brain.validateConversation(draft({searchTerms:[term]}),query);
    assert.deepEqual(plain(result.intent.slotQueries),[term],query);
  }
  assert.deepEqual(plain(brain.validateConversation(draft({searchTerms:["restaurant"]}),"I want sushi").intent.slotQueries),["sushi"]);
  assert.deepEqual(plain(brain.validateConversation(draft({searchTerms:["pizza"]}),"No sushi, I want pizza").intent.slotQueries),["pizza"]);
});

test("model outages clarify unresolved prose and questions while preserving the existing route context", async () => {
  const unavailable=loadModule("conversation.ts", {"./model.ts":{modelJson:async()=>null}});
  const previous=brain.validateConversation(draft(),"Coffee then a park").intent;
  const state={intent:previous,context:["Two quiet stops"],plan:{stops:[{id:"a",name:"Fixture Cafe"},{id:"b",name:"Fixture Park"}]}};
  for (const query of ["What place is open tomorrow?", "Add dessert", "Remove the second stop", "Make it feel more like us", "Is the second place suitable for children?", "Why did you pick that one?", "I have had a really difficult week and need a change"]) {
    const result=await unavailable.understandConversation({},query,"Ottawa",state);
    assert.equal(result.action,"clarify",query);
    assert.deepEqual(plain(result.intent.slotQueries),["cafe","park"]);
    assert.deepEqual(plain(result.context),state.context);
    assert.equal(result.city,"Ottawa");
  }
  const recall=await unavailable.understandConversation({},"What is my second stop?","Ottawa",state);
  assert.equal(recall.action,"reply");
  assert.match(recall.message,/Fixture Park/);
  for (const query of ["Something fun", "I want somewhere that feels magical"]) {
    assert.equal((await unavailable.understandConversation({},query,"Ottawa",{})).action,"clarify");
  }
  const direct=await unavailable.understandConversation({},"Find me Georgian near me","Ottawa",{});
  assert.equal(direct.action,"plan");
  assert.equal(direct.intent.searchTerm,"Georgian");
});
