const test = require('node:test');
const assert = require('node:assert/strict');
const { VersionCache } = require('../build/main/desktop-integration.cjs');
test('版本读取缓存，强制刷新合并并发，更新后失效', async () => {
  let calls = 0;
  const cache = new VersionCache(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return 'v' + calls; });
  assert.deepEqual(await Promise.all([cache.get(), cache.get(), cache.get(true)]), ['v1', 'v1', 'v1']);
  for (let i=0;i<10;i++) assert.equal(await cache.get(), 'v1');
  assert.equal(calls, 1);
  assert.deepEqual(await Promise.all([cache.get(true), cache.get(true)]), ['v2', 'v2']);
  cache.invalidate(); assert.equal(cache.value, null);
  assert.equal(await cache.get(), 'v3');
});
test('失败不缓存；失效前的在途请求不能写回旧版本', async () => {
  let reject = true, resolve;
  const cache = new VersionCache(async () => { if (reject) throw new Error('offline'); return new Promise(done => { resolve=done; }); });
  await assert.rejects(cache.get(), /offline/); reject=false;
  const pending=cache.get(); await Promise.resolve(); cache.invalidate(); resolve('old'); await pending;
  assert.equal(cache.value, null);
});
