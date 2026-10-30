const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { ProjectStore } = require('../build/main/project-store.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-project-drag-'));
const data = path.join(root, 'data'), agent = path.join(root, 'agent');
const artifacts = path.resolve(__dirname, '../artifacts');
for (const directory of [data, agent, artifacts]) fs.mkdirSync(directory, { recursive: true });
const projects = ['alpha','beta','gamma','delta'].map(id => {
  const directory = path.join(root, id); fs.mkdirSync(directory);
  return {id,name:id + (['alpha','delta'].includes(id) ? ' visible' : ''),path:fs.realpathSync(directory),source:'manual'};
});
const file = path.join(data, 'projects.json');
fs.writeFileSync(file, JSON.stringify({version:1,projects,selectedId:'alpha',preferences:{onboardingSeen:true,workspaceTheme:'light',sidebarTheme:'light'}}));
Object.assign(process.env, {PI_GUI_TEST_MODE:'1',PI_GUI_DATA_DIR:data,PI_CODING_AGENT_DIR:agent,
  PI_CODING_AGENT_SESSION_DIR:path.join(agent,'sessions'),PI_OFFLINE:'1',PI_TELEMETRY:'0',PI_SKIP_VERSION_CHECK:'1'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(40); }
  throw new Error('Timeout: ' + label);
}
(async () => {
  let spawns = 0;
  const controller = await require('../build/main/app.cjs').startApp({spawnPty:()=>{spawns++;throw new Error('Drag must not start Pi');}});
  const contents = controller.window.webContents, errors = [];
  contents.on('console-message', event => {if(event.level==='error') {errors.push(event.message);console.error('renderer:',event.message);}});
  const js = source => contents.executeJavaScript(source, true);
  const command = (method, params) => contents.debugger.sendCommand(method, params);
  const order = () => controller.projects.snapshot().projects.map(project => project.id);
  const visibleOrder = () => js('Array.from(document.querySelectorAll("[data-project-id]"),node=>node.dataset.projectId)');
  const idle = () => until(()=>js('!document.querySelector(".project-group.drag-before,.project-group.drag-after,.project-group.dragging")'),'drag visuals cleared');
  await until(()=>js('Boolean(window.__consoleTest && window.piGuiReady && !__consoleTest.library.loading)'),'ready');
  const installProbe = () => js('window.__pointerStarts=[]; document.addEventListener("pointerdown",event=>window.__pointerStarts.push({trusted:event.isTrusted,pointerId:event.pointerId,source:event.target.closest("[data-project-group-id]")?.dataset.projectGroupId}));');
  await js('for (const project of __consoleTest.projects) __consoleTest.setProjectExpanded(project.id,true);');
  await installProbe();
  contents.debugger.attach('1.3');
  await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  const point = (id, edge) => js(`(() => {
    const row=document.querySelector('[data-project-id="${id}"]'), group=row.closest('.project-group');
    const rect=( ${JSON.stringify(edge)} === 'handle' ? group.querySelector('.project-drag-handle') : ${JSON.stringify(edge)} === 'children' ? group.querySelector('.project-sessions') : row ).getBoundingClientRect();
    return {x:Math.round(rect.left+Math.min(80,rect.width/2)),y:Math.round(${JSON.stringify(edge)}==='before'?rect.top+2:rect.top+rect.height/2)};
  })()`);
  const mouse = (type,p,pressed) => command('Input.dispatchMouseEvent',{type,...p,button:pressed || type!=='mouseMoved'?'left':'none',buttons:pressed?1:0,clickCount:1});
  const start = async (id, origin = 'name') => {
    const p = await point(id,origin);
    await mouse('mouseMoved',p,false); await mouse('mousePressed',p,true);
    await mouse('mouseMoved',{x:p.x+10,y:p.y+1},true);
    await until(()=>js('Boolean(document.querySelector(".project-group.dragging"))'),'trusted pointer drag starts');
    const event = await js('window.__pointerStarts.at(-1)');
    assert.equal(event.trusted,true); assert.equal(event.source,id);
    return event.pointerId;
  };
  const hover = async (id,edge) => {const p=await point(id,edge);await mouse('mouseMoved',p,true);return p;};
  const finish = async p => {await mouse('mouseReleased',p,false);await idle();};
  const move = async (source,target,edge,expected) => {
    await start(source); const p = await hover(target,edge);
    await until(()=>js('Boolean(document.querySelector(".project-group.drag-'+(edge==='before'?'before':'after')+'"))'),'full-group insertion indicator');
    await finish(p);
    await until(()=>JSON.stringify(order())===JSON.stringify(expected),'order saved: '+expected.join(','));
    assert.deepEqual(await visibleOrder(),expected);
  };
  const escape = async () => {
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  };
  const clickPoint = await point('alpha','name');
  await mouse('mouseMoved',clickPoint,false); await mouse('mousePressed',clickPoint,true);
  await mouse('mouseMoved',{x:clickPoint.x+2,y:clickPoint.y},true); await mouse('mouseReleased',clickPoint,false);
  await until(()=>js('!__consoleTest.expandedProjects.has("alpha")'),'sub-threshold motion remains an ordinary project click');
  assert.deepEqual(order(),['alpha','beta','gamma','delta']);
  await js('__consoleTest.setProjectExpanded("alpha",true)');
  await move('gamma','alpha','before',['gamma','alpha','beta','delta']);
  assert.equal(await js('window.getSelection().toString()'),'','dragging names does not select text');
  await start('gamma','handle'); const p = await hover('beta','children');
  await until(()=>js('document.querySelector("[data-project-id=beta]").closest(".project-group").classList.contains("drag-after")'),'expanded session area accepts the drop');
  const indicator = await js('(() => {const group=document.querySelector(".project-group.drag-after"),style=getComputedStyle(group,"::after");return {content:style.content,color:style.backgroundColor,height:parseFloat(style.height),width:parseFloat(style.width)};})()');
  assert.equal(indicator.content,'""'); assert.notEqual(indicator.color,'rgba(0, 0, 0, 0)'); assert(indicator.height>=2 && indicator.width>150,'insertion line spans the project group');
  await delay(80);
  fs.writeFileSync(path.join(artifacts,'project-drag-expanded-light.png'),(await contents.capturePage()).toPNG());
  await finish(p);
  await until(()=>JSON.stringify(order())===JSON.stringify(['alpha','beta','gamma','delta']),'drop after the complete expanded group');
  assert.equal(await js('__consoleTest.selectedId'),'alpha','dragging does not select or collapse projects');
  assert.equal(await js('__consoleTest.expandedProjects.size'),4);

  for(const cancel of ['Escape','blur','pointercancel','lostpointercapture']) {
    const before=order(), pointerId=await start('delta'), p=await hover('alpha','before');
    if(cancel==='Escape') await escape();
    else if(cancel==='blur') await js('window.dispatchEvent(new Event("blur"))');
    else await js('window.dispatchEvent(new PointerEvent('+JSON.stringify(cancel)+',{pointerId:'+pointerId+'}))');
    await finish(p); assert.deepEqual(order(),before,cancel+' cancels without saving');
  }
  // Unrelated HTML drags cannot reorder projects now that ordering uses pointer gestures.
  await js('(() => {const target=document.querySelector("[data-project-id=alpha]"), transfer=new DataTransfer();transfer.setData("application/x-pi-project","delta");target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:target.getBoundingClientRect().top+1}));})()');
  assert.deepEqual(order(),['alpha','beta','gamma','delta']);
  await js('__consoleTest.search="visible";__consoleTest.publish()');
  assert.deepEqual(await visibleOrder(),['alpha','delta']);
  await start('delta'); await finish(await hover('alpha','before'));
  await until(()=>order()[0]==='delta','filtered move persisted');
  assert.deepEqual(order(),['delta','alpha','beta','gamma'],'hidden projects remain in the complete permutation');
  await js('__consoleTest.search="";__consoleTest.publish()');
  controller.projects.setProjectPinned('alpha',true); controller.projects.setProjectPinned('beta',true);
  await controller.refreshLibrary();
  await until(async()=>JSON.stringify(await visibleOrder())===JSON.stringify(['alpha','beta','delta','gamma']),'pinned projects grouped first');
  await start('beta'); await finish(await hover('alpha','before'));
  await until(async()=>JSON.stringify(await visibleOrder())===JSON.stringify(['beta','alpha','delta','gamma']),'pinned projects reorder within their group');
  const beforeCross=order(); await start('gamma'); const crossPoint=await hover('beta','before');
  assert.equal(await js('Boolean(document.querySelector(".project-group.drag-before,.project-group.drag-after"))'),false,'cross-pin drops have no insertion indicator');
  await finish(crossPoint); assert.deepEqual(order(),beforeCross,'dragging does not silently change project pins');
  assert.deepEqual(new ProjectStore(file).snapshot().projects.map(project=>project.id),order(),'order survives reading the stored profile');
  await new Promise(resolve=>{contents.once('did-finish-load',resolve);contents.reload();});
  await until(()=>js('Boolean(window.__consoleTest && window.piGuiReady && !__consoleTest.library.loading)'),'reloaded');
  assert.deepEqual(await visibleOrder(),['beta','alpha','delta','gamma'],'visible order survives restart');
  // A long list scrolls only while an active gesture is held near its edge.
  for(let i=0;i<18;i++) {const directory=path.join(root,'extra-'+i);fs.mkdirSync(directory);controller.projects.add(directory);}
  await controller.refreshLibrary(); controller.window.setContentSize(940,620); await delay(100);
  await js('document.querySelector(".sidebar-library").scrollTop=0');
  await installProbe();
  const beforeScroll=order(); await start('delta');
  const edge=await js('(() => {const r=document.querySelector(".sidebar-library").getBoundingClientRect();return {x:Math.round(r.left+80),y:Math.round(r.bottom-4)};})()');
  await mouse('mouseMoved',edge,true);
  await until(()=>js('document.querySelector(".sidebar-library").scrollTop > 60'),'edge autoscroll');
  await escape(); await finish(edge);
  const scrollTop=await js('document.querySelector(".sidebar-library").scrollTop');await delay(100);
  assert.equal(await js('document.querySelector(".sidebar-library").scrollTop'),scrollTop,'cancel stops the scroll animation');
  assert.deepEqual(order(),beforeScroll);
  assert.equal(spawns,0); assert.deepEqual(errors,[]);
  console.log('PASS project drag: trusted pointer input on name/handle, expanded group drops, insertion feedback, cancel cleanup, filtered order, pin groups, persistence and bounded autoscroll; no Pi launched');
  fs.rmSync(root,{recursive:true,force:true}); app.exit(0);
})().catch(error=>{console.error(error);fs.rmSync(root,{recursive:true,force:true});app.exit(1);});
