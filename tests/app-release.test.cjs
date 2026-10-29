const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAppVersion, compareAppVersions, selectAppRelease, AppReleaseChecker } = require('../build/main/app-release.cjs');
const entry = tag => `<entry><id>tag:github.com,2008:Repository/123/${tag}</id><title>Release</title></entry>`;
const feed = (...tags) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${tags.map(entry).join('')}</feed>`;

test('候选版与正式版按语义版本排序，不依赖订阅源顺序', () => {
  const versions = ['0.0.1-snapshot.9','0.0.1-rc.1','0.0.1-rc.10','0.0.1','0.0.2-rc.1','0.0.2'];
  for (let i = 1; i < versions.length; i++) assert(compareAppVersions(parseAppVersion(versions[i-1]), parseAppVersion(versions[i])) < 0);
  for (const invalid of ['1.0', 'v01.0.0', '1.2.3-beta.1', '1.2.3-rc.01', '999999999999999999.0.0', 'v1.2.3/../../x']) assert.equal(parseAppVersion(invalid), null);
  const data = feed('v0.0.3-rc.1','v0.0.2','v0.0.1-rc.2','v0.0.1');
  const stable = selectAppRelease('0.0.1', data);
  assert.equal(stable.latestVersion, '0.0.2'); assert.equal(stable.channel, 'stable'); assert.equal(stable.available, true);
  const rc = selectAppRelease('0.0.1-rc.1', data);
  assert.equal(rc.latestVersion, '0.0.3-rc.1'); assert.equal(rc.channel, 'prerelease');
  assert.equal(rc.url, 'https://github.com/lsfcy/pi-console/releases/tag/v0.0.3-rc.1');
  assert.equal(selectAppRelease('0.0.4', data).available, false, 'never suggest a downgrade');
});
test('拒绝非版本 tag、错误格式及释放说明中的伪造内容', () => {
  const invalid = feed('7.0.0','v6.0.0/../../x','v5.0.0-beta.1');
  assert.throws(()=>selectAppRelease('0.0.1',invalid), /compatible/);
  assert.throws(()=>selectAppRelease('bad',feed('v0.0.1')), /feed/);
  assert.throws(()=>selectAppRelease('0.0.1','<feed><entry>'), /feed/);
  const data = `<feed>${entry('v0.0.1')}<entry><title>v9.0.0</title><content>&lt;id&gt;tag:github.com,2008:Repository/1/v9.0.0&lt;/id&gt;</content></entry></feed>`;
  assert.equal(selectAppRelease('0.0.1',data).latestVersion,'0.0.1');
});
test('网络只访问固定 GitHub 订阅源、并发合并、成功缓存，手动可刷新', async () => {
  let calls=0, now=0; const requests=[];
  const checker = new AppReleaseChecker('0.0.1-rc.1', async (url, options) => {
    calls++; requests.push({url,options}); await new Promise(resolve=>setTimeout(resolve,10));
    return new Response(feed('v0.0.1-rc.2'));
  }, () => now);
  const [a,b]=await Promise.all([checker.check(),checker.check(true)]);
  assert.equal(a.latestVersion,'0.0.1-rc.2'); assert.equal(b.latestVersion,a.latestVersion); assert.equal(calls,1);
  assert.equal(requests[0].url,'https://github.com/lsfcy/pi-console/releases.atom');
  assert.equal(requests[0].options.redirect,'error'); assert(requests[0].options.signal instanceof AbortSignal);
  await checker.check(); assert.equal(calls,1);
  await checker.check(true); assert.equal(calls,2);
  now += 3600001; await checker.check(); assert.equal(calls,3);
});
test('HTTP 错误、异常订阅源和超大响应不缓存，可手动重试', async () => {
  let calls=0;
  const checker = new AppReleaseChecker('0.0.1', async () => {
    calls++;
    if (calls===1) return new Response('',{status:403});
    if (calls===2) return new Response('not XML');
    if (calls===3) return new Response('x'.repeat(1024*1024+1));
    return new Response(feed('v0.0.1'));
  });
  await assert.rejects(checker.check(), /403/);
  await assert.rejects(checker.check(), /feed/);
  await assert.rejects(checker.check(), /large/);
  assert.equal((await checker.check(true)).available,false); assert.equal(calls,4);
});
