// node tests/test_lightmap_refresh.cjs [path/to/editor/static/app.js]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const file = process.argv[2] || path.join(__dirname, '../editor/static/app.js');
const text = fs.readFileSync(file, 'utf8');
const start = text.indexOf('function loadLightmap('), end = text.indexOf('\nfunction variant(', start);
assert(start >= 0 && end > start);
const requests = [], ctx = {lightmapRevision:0, lightAtlas:null, litGeos:new Map(),
  THREE:{SRGBColorSpace:'srgb',LinearFilter:'linear'}, Date:{now:()=>123},
  applied:0,woken:0,warnings:[], applyLighting(){ctx.applied++;},wake(){ctx.woken++;},log(...a){ctx.warnings.push(a);},
  loader:{load(url,ready,progress,failed){const texture={dispose(){this.disposed=true;}};requests.push({url,ready,failed,texture});return texture;}}};
vm.createContext(ctx);vm.runInContext(text.slice(start,end),ctx);
ctx.loadLightmap('/cache/map/lightmap.png',{A:1},[[1]],{B:2});const first=ctx.lightAtlas;
let disposed=0;ctx.litGeos.set('mesh',{geo:{dispose(){disposed++;}}});
ctx.loadLightmap('/cache/map/lightmap.png',{A:3},[[2]],{B:4});
assert(first.disposed);assert.equal(disposed,1);assert.equal(ctx.litGeos.size,0);
assert.notEqual(requests[0].url,requests[1].url,'Even same-millisecond loads must have unique image identities');
assert.deepEqual(ctx.actorLight,{A:3});assert.deepEqual(ctx.mapLights,[[2]]);assert.deepEqual(ctx.objectLight,{B:4});
requests[0].ready();requests[0].failed();assert.equal(ctx.applied,0);assert.equal(ctx.warnings.length,0);
requests[1].ready();assert.equal(ctx.applied,1);assert.equal(ctx.woken,1);
assert.equal(ctx.lightAtlas.flipY,false);assert.equal(ctx.lightAtlas.colorSpace,'srgb');assert.equal(ctx.lightAtlas.channel,1);
assert.equal(ctx.lightAtlas.generateMipmaps,false);assert.equal(ctx.lightAtlas.minFilter,'linear');
ctx.loadLightmap('/cache/map/lightmap.png?variant=1',{},[],{});
assert(requests[2].url.startsWith('/cache/map/lightmap.png?variant=1&lightBuild='));
requests[2].failed();assert.equal(ctx.warnings.length,1);assert.equal(ctx.warnings[0][1],'warn');
ctx.loadLightmap(null,{},[],{});assert.equal(ctx.lightAtlas,null);requests[2].ready();assert.equal(ctx.applied,1);
console.log('PASS lightmap revision, disposal, data refresh, redraw, stale callbacks, query strings and errors');
