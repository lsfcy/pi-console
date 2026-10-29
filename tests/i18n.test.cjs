const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const i18n = require('../build/shared/i18n.js');
const { dialogsEn } = require('../build/shared/locales/dialogs.js');
const { sessionsEn } = require('../build/shared/locales/sessions.js');
const { mainEn } = require('../build/shared/locales/main.js');
const { shellEn } = require('../build/shared/locales/shell.js');
const cjk = /[\u4e00-\u9fff]/;

test('中文是默认基线，英文可切换并支持变量', () => {
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.t('设置'), '设置');
  assert.equal(i18n.t('打开“{name}”', { name: '项目' }), '打开“项目”');
  i18n.setLanguage('en-US');
  assert.equal(i18n.t('设置'), 'Settings');
  assert.equal(i18n.t('打开“{name}”', { name: 'project' }), '打开“project”');
  assert.equal(i18n.t('未翻译的测试字符串'), '未翻译的测试字符串');
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.getLanguage(), 'zh-CN');
});

test('词表完整、非空、英文无中文残留且占位符一致', () => {
  const catalogs = { dialogsEn, sessionsEn, mainEn, shellEn };
  for (const [name, catalog] of Object.entries(catalogs)) {
    for (const [source, translated] of Object.entries(catalog)) {
      assert.ok(translated.trim(), name + ' 的空翻译：' + source);
      assert.equal(cjk.test(translated), false, name + ' 英文仍含中文：' + source + ' → ' + translated);
      const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      assert.deepEqual(placeholders(translated), placeholders(source), name + ' 占位符不一致：' + source);
    }
  }
});

test('源码中的中文文案都有英文词条', () => {
  const roots = ['src/renderer', 'src/main', 'src/shared', 'src/pi'];
  const missing = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.(tsx?|cts)$/.test(file) || file.includes(path.sep + 'locales' + path.sep) || file.endsWith(path.join('shared', 'i18n.ts'))) continue;
      const source = fs.readFileSync(file, 'utf8');
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = node => {
        const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text
          : ts.isJsxText(node) ? node.text.trim() : null;
        if (text && cjk.test(text) && !Object.hasOwn(i18n.en, text)) missing.push(file + ': ' + text);
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(missing, []);
});
