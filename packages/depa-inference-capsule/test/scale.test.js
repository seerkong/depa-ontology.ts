'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInferenceCapsule, explain, factId } = require('../index');
const v = name => ({var:name});
const atom = (relation,...terms) => ({relation,terms:terms.map(v)});
const program = {id:'scale',version:'1',relations:[{name:'edge',arity:2},{name:'hit',arity:1}],rules:[{id:'propagate',head:atom('hit','child'),body:[atom('edge','child','parent'),atom('hit','parent')]}]};

for (const count of [100, 1000, 10000]) {
  for (const topology of ['chain', 'fanout']) {
    test(`${count} input facts ${topology} report bounded completion or explicit deep-chain timeout`, async () => {
      const facts = [{relation:'hit',values:['0']}, ...Array.from({length:count-1},(_,i)=>({relation:'edge',values:[String(i+1),topology==='chain'?String(i):'0']}))];
      const before = process.memoryUsage().rss;
      const boundedDeepChain = topology === 'chain' && count === 10000;
      const result = await createInferenceCapsule({budget:{timeoutMs:boundedDeepChain?1000:5000,maxInputFacts:10000,maxFacts:20000,maxSupports:10000}}).infer({epoch:`${topology}-${count}`,program,facts});
      if (boundedDeepChain) {
        assert.equal(result.status,'incomplete');
        assert.equal(result.diagnostics[0].code,'TIMEOUT');
        assert.ok(result.stats.elapsedMs < 5000);
        console.log(JSON.stringify({runtime:process.versions.bun?'bun':'node',count,topology,status:result.status,elapsedMs:result.stats.elapsedMs,rssDeltaBytes:process.memoryUsage().rss-before}));
        return;
      }
      assert.equal(result.status,'complete',JSON.stringify(result.diagnostics));
      assert.equal(result.facts.length,count*2-1);
      assert.equal(result.supports.length,count-1);
      const explanation = explain(result,factId('hit',[String(count-1)]));
      assert.equal(explanation.complete,true);
      assert.equal(explanation.supports.length,topology==='chain'?count-1:1);
      console.log(JSON.stringify({runtime:process.versions.bun?'bun':'node',count,topology,elapsedMs:result.stats.elapsedMs,rssDeltaBytes:process.memoryUsage().rss-before,supports:result.supports.length}));
    });
  }
}
