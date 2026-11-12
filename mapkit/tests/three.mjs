// The three.js the tests run with: the 0.160.0 the editor's page loads from its import map
// (editor/static/index.html), taken from a copy on this PC, never downloaded. The first one found of
//   DEUSEDIX_THREE_MODULE                         a three.module.js of 0.160.0 (an error if it is not that)
//   ../editor/static/vendor/three                 the editor's own copy (shipped with it since 12 Nov 2026)
//   ../../research/rea-blender/three.module.mjs   beside tools/mapkit in a development working copy
//   three in a node_modules                       npm install --no-save three@0.160.0 in mapkit
// Without one the tests that need it are skipped, saying why: `test` from here skips every test of a file,
// and a file with only a few such tests gives those { skip: noThree }.
import nodeTest from 'node:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REVISION = '160';
const own = process.env.DEUSEDIX_THREE_MODULE;

function places() {
  if (own) {
    if (!existsSync(own)) throw new Error(`DEUSEDIX_THREE_MODULE: there is no ${path.resolve(own)}`);
    return [pathToFileURL(path.resolve(own)).href];
  }
  const list = [new URL('../editor/static/vendor/three/build/three.module.js', import.meta.url).href,
    new URL('../../research/rea-blender/three.module.mjs', import.meta.url).href];
  try { list.push(import.meta.resolve('three')); } catch { /* no three in a node_modules above this folder */ }
  return list.filter((url) => existsSync(fileURLToPath(url)));
}

async function find() {
  const others = [];                                  // copies of another revision, named when skipping
  for (const url of places()) {
    const module = await import(url);
    if (module.REVISION === REVISION) return { module, url, others };
    if (own) throw new Error(`DEUSEDIX_THREE_MODULE is three.js r${module.REVISION}, the editor uses 0.160.0`);
    others.push(`r${module.REVISION} at ${fileURLToPath(url)}`);
  }
  return { module: null, url: null, others };
}

const found = await find();
// the module, and its file: URL for the editor's modules that import 'three' (null without one)
export const THREE = found.module, threeURL = found.url;
// false, or why the tests that need three.js are skipped
export const noThree = THREE ? false : `needs three.js 0.160.0, ${found.others.length ? 'found only ' + found.others.join(', ') : 'not found'}`
  + ': npm install --no-save three@0.160.0 in mapkit, or set DEUSEDIX_THREE_MODULE (tests/three.mjs)';
// node:test's test, or without three.js the same test skipped
export default THREE ? nodeTest : (name) => nodeTest(name, { skip: noThree });
