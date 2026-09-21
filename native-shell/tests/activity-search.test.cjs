const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function backend(fetch) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('explore-search/index.ts')) source += '\nexport { v2ExploreResponse };';
    const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js, {exports, fetch, Request, Response, URL, AbortController, setTimeout, clearTimeout, console,
      Deno:{serve(){},env:{get:key=>key==='GOOGLE_PLACES_API_KEY' ? 'fixture-key':undefined}},
      require(name) {
        if (name==='../_shared/location.ts') return {readLocationCache:async()=>null,writeLocationCache:async()=>{},sha256Hex:async()=> 'fixture-cache'};
        return load(path.resolve(path.dirname(file), name));
      },
    });
    return exports;
  }
  return load(path.resolve(__dirname,'../../supabase/functions/explore-search/index.ts'));
}

async function explore(city, fetch) {
  const {v2ExploreResponse} = backend(fetch);
  const rpcCalls = [];
  const result = await v2ExploreResponse({
    req:new Request('https://echoo.test/functions/v1/explore-search'),
    supabase:{rpc:async(name,input)=>{rpcCalls.push({name,input});return {data:[],error:null};}},
    query:'bowling alleys', inventoryQuery:'bowling', intent:{id:'search',label:'Search',providerQuery:'bowling alleys'},
    city:{name:city,coverageLevel:'municipality'},cityFilter:city,limit:20,radiusMeters:25000,
    category:null,cultureSlug:null,featureSlugs:[],preferenceFeatureSlugs:[],cursor:null,includeLiveFallback:true,
  });
  return {result,rpcCalls};
}

test('live activity cards appear in the main results and each selected city reaches both providers', async()=>{
  for (const city of ['Toronto','Ottawa','Hamilton','Mississauga']) {
    let googleQuery;
    const {result,rpcCalls} = await explore(city,async(_url,options)=>{
      googleQuery=JSON.parse(options.body).textQuery;
      return new Response(JSON.stringify({places:[{id:'fixture-bowling',displayName:{text:'Fixture Lanes'},types:['bowling_alley','establishment'],location:{latitude:43,longitude:-79},formattedAddress:`1 Test St, ${city}`,addressComponents:[{types:['country'],shortText:'CA'},{types:['administrative_area_level_1'],shortText:'ON'},{types:['locality'],longText:city}]}]}));
    });
    assert.equal(rpcCalls[0].input.p_city,city);
    assert.equal(rpcCalls[0].input.p_query,'bowling');
    assert.ok(googleQuery.includes(`in ${city}, Ontario`));
    assert.equal(result.all.items.length,1);
    assert.equal(result.all.items[0].title,'Fixture Lanes');
    assert.equal(result.all.items[0].city,city);
    assert.equal(result.all.items[0].community,undefined);
    assert.ok(result.all.items[0].features.includes('bowling alley'));
    assert.equal(result.meta.liveSearch.status,'available');
  }
});

test('provider outage is different from a successful search with no matches', async()=>{
  const failed = await explore('Ottawa',async()=>new Response(JSON.stringify({error:{details:[{reason:'BILLING_DISABLED'}]}}),{status:403}));
  assert.equal(failed.result.all.items.length,0);
  assert.equal(failed.result.meta.liveSearch.reason,'billing_disabled');
  const empty = await explore('Ottawa',async()=>new Response(JSON.stringify({places:[]})));
  assert.equal(empty.result.all.items.length,0);
  assert.equal(empty.result.meta.liveSearch.status,'available');
});
