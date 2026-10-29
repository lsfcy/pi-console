const test = require('node:test'), assert = require('node:assert/strict');
const { relativeSessionTime } = require('../build/shared/format.js');
test('会话相对时间覆盖分钟、小时、天、月和年边界，异常值不崩溃', () => {
  const now = Date.parse('2026-10-23T12:00:00Z'), minute = 60000;
  for (const [minutes, expected] of [[0,'刚刚'],[.9,'刚刚'],[1,'1分钟'],[59,'59分钟'],[60,'1小时'],
    [1439,'23小时'],[1440,'1天'],[29*1440,'29天'],[30*1440,'1个月'],[60*1440,'2个月'],[365*1440,'1年']])
    assert.equal(relativeSessionTime(now-minutes*minute, now), expected);
  assert.equal(relativeSessionTime(now+minute, now), '刚刚');
  for (const value of [NaN, Infinity, -1, 0]) assert.equal(relativeSessionTime(value, now), '');
});
