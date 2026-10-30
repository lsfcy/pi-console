const test = require('node:test');
const assert = require('node:assert/strict');
const { projectOrderAfterMove, orderedProjects } = require('../build/shared/view-model.js');
const projects = ['a','hidden','b','c'].map(id => ({id,name:id,path:'/' + id}));
test('项目拖拽支持上下移动、前后插入，完整保留搜索隐藏项且不修改原快照', () => {
  const before = structuredClone(projects);
  assert.deepEqual(projectOrderAfterMove(projects,'c','a','before'), ['c','a','hidden','b']);
  assert.deepEqual(projectOrderAfterMove(projects,'a','c','after'), ['hidden','b','c','a']);
  assert.deepEqual(projectOrderAfterMove(projects,'a','b','after'), ['hidden','b','a','c']);
  assert.deepEqual(projectOrderAfterMove(projects,'c','b','before'), ['a','hidden','c','b']);
  assert.deepEqual(projects,before);
});
test('无效来源、目标、自身、原位置和跨置顶分组的拖放不保存', () => {
  for (const [source,target,edge] of [['missing','a','before'],['a','missing','after'],['a','a','after'],['a','hidden','before'],['b','hidden','after']]) {
    assert.equal(projectOrderAfterMove(projects,source,target,edge),null);
  }
  const pinned = projects.map(project => ({...project,...(project.id==='b'?{pinned:true}:{})}));
  assert.equal(projectOrderAfterMove(pinned,'a','b','after'),null);
  assert.equal(projectOrderAfterMove(pinned,'b','c','before'),null);
});
test('置顶项目组内可重排且保留置顶属性，非置顶排序不影响置顶分组', () => {
  const all = ['a','b','c','d'].map(id => ({id,name:id,path:'/'+id,...(['b','d'].includes(id)?{pinned:true}:{})}));
  const ids = projectOrderAfterMove(all,'d','b','before');
  assert.deepEqual(ids,['a','d','b','c']);
  const reordered = ids.map(id => all.find(project => project.id===id));
  assert.deepEqual(orderedProjects(reordered).map(project => project.id),['d','b','a','c']);
  assert(reordered.filter(project=>project.pinned).every(project=>['b','d'].includes(project.id)));
});
