const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shortcuts = require('../build/shared/shortcuts.js');
const {NavigationHistory} = require('../build/shared/navigation-history.js');
const {ProjectStore} = require('../build/main/project-store.cjs');
const event = (code, extras={}) => ({code,metaKey:true,...extras});
test('默认应用键不抢占 Pi 的 Option 和 Ctrl',()=>{
  const bindings=shortcuts.bindings();
  for (const [code,id] of [['ArrowLeft','previous-tab'],['ArrowRight','next-tab'],['ArrowUp','sidebar-previous'],['ArrowDown','sidebar-next']]) {
    assert.equal(shortcuts.match(event(code)),id);
    assert.equal(shortcuts.match(event(code,{metaKey:false,altKey:true})),null);
    assert.equal(shortcuts.match(event(code,{metaKey:false,ctrlKey:true})),null);
  }
  for (const digit of '1234567890') {
    assert.equal(bindings['project-'+digit], 'Command+'+digit);
    assert.equal(shortcuts.match(event('Digit'+digit)), 'project-'+digit);
    assert.equal(shortcuts.match(event('Digit'+digit,{metaKey:false,altKey:true})),null);
  }
  for (const code of ['BracketLeft','BracketRight','KeyT','KeyP']) {
    assert.equal(shortcuts.match(event(code,{metaKey:false,ctrlKey:true})),null);
  }
  assert.equal(shortcuts.match(event('KeyR',{isComposing:true})),null);
  assert.equal(shortcuts.match(event('BracketLeft')),'back');
  assert.equal(shortcuts.match(event('BracketRight')),'forward');
});
test('规范化和自定义拒绝系统、Pi 及重复快捷键',()=>{
  assert.deepEqual(shortcuts.validateOverrides({'running-recent':'Shift+Command+Y','open-terminal':null,'new-tab':'Command+N'}),{'running-recent':'Command+Shift+Y','open-terminal':null});
  assert.equal(shortcuts.fromEvent(event('KeyS',{altKey:true,key:'ß'})),'Command+Alt+S');
  assert.equal(shortcuts.fromEvent(event('Digit1',{key:'¡'})),'Command+1');
  assert.equal(shortcuts.fromEvent(event('KeyC')),'Command+C');
  assert.throws(()=>shortcuts.validateOverrides({'running-recent':shortcuts.fromEvent(event('KeyC'))}),/保留/);
  assert.equal(shortcuts.fromEvent(event('ArrowLeft',{metaKey:false,altKey:true})),null);
  for(const value of ['Alt+Left','Alt+1','Control+T','Command+C','Command+Space','Command+Shift+3','Command+Shift+4','Command+Shift+5','Command+Shift+Up']) assert.throws(()=>shortcuts.normalize(value), value);
  assert.throws(()=>shortcuts.validateOverrides({'project-1':'Command+2'}),/冲突/);
  assert.throws(()=>shortcuts.validateOverrides({'missing':'Command+Y'}));
});
test('旧 Option 配置迁移时保留其他自定义设置并避免冲突',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-shortcuts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'projects.json');
  fs.writeFileSync(file,JSON.stringify({version:1,projects:[],selectedId:null,preferences:{shortcuts:{'sidebar-next':'Alt+Down','running-recent':'Command+Y','project-1':null}}}));
  const store=new ProjectStore(file), persisted=store.preferences().shortcuts;
  assert.deepEqual(persisted,{'running-recent':'Command+Y','project-1':null});
  assert.equal(shortcuts.match(event('ArrowDown',{metaKey:false,altKey:true}),persisted),null);
  assert.equal(shortcuts.match(event('KeyY'),persisted),'running-recent');
  store.setPreferences({shortcuts:persisted});
  assert.deepEqual(new ProjectStore(file).preferences().shortcuts,persisted);
  const before=fs.readFileSync(file);
  assert.throws(()=>store.setPreferences({shortcuts:{'running-recent':'Command+N'},fontSize:18}),/冲突/);
  assert(fs.readFileSync(file).equals(before));
  store.setPreferences({shortcuts:{}});
  assert.equal(JSON.parse(fs.readFileSync(file)).preferences.shortcuts,undefined);
});
test('旧 Shell 命令不再保留，Cmd+T 迁移为外部终端', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-shell-migrate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'projects.json');
  fs.writeFileSync(file,JSON.stringify({version:1,projects:[],selectedId:null,preferences:{shellHeight:300,shortcuts:{'toggle-shell':'Command+Y','new-shell':'Command+Y'}}}));
  const store=new ProjectStore(file);
  assert.equal(shortcuts.defaults['open-terminal'],'Command+T');
  assert.equal(shortcuts.defaults['toggle-shell'],undefined);
  assert.deepEqual(store.preferences().shortcuts,{'open-terminal':'Command+Y'});
  store.setPreferences({});
  const saved=JSON.parse(fs.readFileSync(file)).preferences;
  assert.equal(saved.shellHeight,undefined);
  assert.equal(saved.shortcuts['toggle-shell'],undefined);
  assert.equal(saved.shortcuts['new-shell'],undefined);
  assert.equal(saved.shortcuts['open-terminal'],'Command+Y');
});
const project=(id,terminalId='history')=>({route:'project',projectId:id,terminalId,query:'',filter:'all',timeRange:'month'});
test('返回/前进记录项目和标签；同页搜索、时间范围与滚动仅更新当前记录',()=>{
  const nav=new NavigationHistory();
  nav.visit(project('a'));nav.visit(project('a','t1'));
  nav.visit({...project('a','t1'),query:'needle',historyScroll:100});
  assert.equal(nav.entries.length,2);
  nav.visit({route:'recent',filter:'running',timeRange:'month'});
  const previous=nav.move(-1);assert.equal(previous.terminalId,'t1');assert.equal(previous.query,'needle');
  previous.query='mutated';assert.equal(nav.entries[nav.index].query,'needle','history snapshots are not shared references');
  assert.equal(nav.move(1).filter,'running');
});
test('设置分类不刷屏历史，返回后新导航删除前进分支，扫描不新增重复记录',()=>{
  const nav=new NavigationHistory();nav.visit(project('a'));
  nav.visit({route:'settings',settingsSection:'appearance'});nav.visit({route:'settings',settingsSection:'shortcuts'});
  assert.equal(nav.entries.length,2);assert.equal(nav.move(-1).projectId,'a');
  nav.visit(project('b'));assert.equal(nav.canMove(1),false);
  nav.visit(project('b'));assert.equal(nav.entries.length,2);
});
test('导航跳过已删除项目，有界存储与边界按钮保持一致，异常方向不会循环',()=>{
  const nav=new NavigationHistory(3);
  for(const id of ['a','b','c','d']) nav.visit(project(id));
  assert.deepEqual(nav.entries.map(state=>state.projectId),['b','c','d']);
  const valid=state=>state.projectId!=='c';
  assert.equal(nav.move(-1,valid).projectId,'b');assert.equal(nav.canMove(-1,valid),false);
  assert.equal(nav.move(1,valid).projectId,'d');assert.equal(nav.move(1,valid),null);
  assert.equal(nav.canMove(0),false);assert.equal(nav.move(0),null);
});
