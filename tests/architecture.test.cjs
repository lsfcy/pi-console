const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { builtinModules } = require('node:module');
const root = path.resolve(__dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(?:tsx?|cts)$/.test(file) ? [file] : [];
  });
}
const sources = files(path.join(root, 'src'));
function runtimeImports(source) {
  const imports = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly = clause?.isTypeOnly || clause?.namedBindings && ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly);
      if (!typeOnly) imports.add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) imports.add(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      imports.add(node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : '<dynamic>');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}
test('renderer、shared 与 preload 的运行时导入遵守边界', () => {
  for (const file of sources) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const specifier of runtimeImports(source)) {
      if (!relative.startsWith('src/main/')) assert.notEqual(specifier, '<dynamic>', relative);
      const resolved = specifier.startsWith('.') ? path.relative(root, path.resolve(path.dirname(file), specifier)).replaceAll(path.sep, '/') : specifier;
      if (relative.startsWith('src/renderer/')) {
        assert(!specifier.startsWith('node:') && !builtinModules.includes(specifier) && !/^(electron|node-pty)(\/|$)/.test(specifier), relative + ' -> ' + specifier);
        assert(!/^src\/(main|preload|pi)\//.test(resolved), relative + ' -> ' + resolved);
      }
      if (relative.startsWith('src/shared/')) {
        assert(resolved.startsWith('src/shared/'), relative + ' -> ' + resolved);
      }
      if (relative.startsWith('src/preload/')) assert.equal(specifier, 'electron', relative);
      if (relative.startsWith('src/main/')) assert(!resolved.startsWith('src/renderer/'), relative + ' -> ' + resolved);
    }
  }
});
test('页面由 React 管理，不保留手工 DOM 渲染器或全局命名空间', () => {
  for (const file of sources.filter(file => /src[/\\](?:renderer|shared)[/\\]/.test(file))) {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\bnamespace\s+PiGui/.test(source), file);
    assert(!/dangerouslySetInnerHTML|\.replaceChildren\(|\.innerHTML\s*=/.test(source), file);
    if (!file.endsWith('terminal-view.ts')) assert(!/document\.createElement\(/.test(source), file);
  }
});
test('应用提醒必须复用自定义 Dialog，不允许退回系统消息框', () => {
  for(const file of sources) {
    const source=fs.readFileSync(file,'utf8');
    assert(!/showMessageBox|showErrorBox|window\.(?:alert|confirm|prompt)\(/.test(source),file);
  }
});
test('普通渲染器的诊断接口有显式测试模式边界', () => {
  const source = fs.readFileSync(path.join(root, 'src/renderer/App.tsx'), 'utf8');
  assert(source.includes('app.ready && app.testMode'));
  assert(source.includes('delete window.__consoleTest'));
  const preload = fs.readFileSync(path.join(root, 'src/preload/index.cts'), 'utf8');
  assert(!preload.includes('ipcRenderer:'));
});
test('文档和包元数据不依赖本地绝对路径，产物与认证文件不进入 Git', () => {
  for (const name of ['README.md', 'RELEASING.md', 'CONTRIBUTING.md', 'SECURITY.md', 'package.json']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert(!/\/Users\/|[A-Z]:\\Users\\/.test(source), name);
  }
  const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const item of ['build/', 'node_modules/', 'artifacts/', '.env', '*.key']) assert(ignored.includes(item), item);
});
