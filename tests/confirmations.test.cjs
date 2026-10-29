const test = require('node:test'), assert = require('node:assert/strict');
const { Confirmations } = require('../build/main/confirmations.cjs');
const options = { type:'warning', message:'Delete?', buttons:['Cancel','Delete'], cancelId:0 };
test('确认串行展示，拒绝过期/伪造响应，关闭窗口默认取消所有操作', async () => {
  let shown;
  const confirmations = new Confirmations(request => { shown=request; });
  const first=confirmations.ask({...options,checkboxLabel:'Remember'}), id=shown.id;
  const second=confirmations.ask(options);
  assert.equal(shown.id,id);
  assert.throws(()=>confirmations.answer('wrong',{response:1,checkboxChecked:false}),/已关闭/);
  for(const response of [-1,2,NaN,'1']) assert.throws(()=>confirmations.answer(id,{response,checkboxChecked:false}),/无效/);
  confirmations.answer(id,{response:1,checkboxChecked:true});
  assert.deepEqual(await first,{response:1,checkboxChecked:true});
  assert.notEqual(shown.id,id);
  confirmations.cancelAll();
  assert.deepEqual(await second,{response:0,checkboxChecked:false});assert.equal(shown,null);
});
test('退出确认保留明确的危险按钮位置，不改变取消和保留 Pi 的响应值',async()=>{
  let shown;const c=new Confirmations(request=>{shown=request;});
  const result=c.ask({...options,buttons:['Cancel','Keep Pi and Quit','End Pi and Quit'],destructiveId:2,defaultId:1});
  assert.equal(shown.destructiveId,2);assert.equal(shown.cancelId,0);assert.equal(shown.defaultId,1);
  c.answer(shown.id,{response:1,checkboxChecked:false});
  assert.deepEqual(await result,{response:1,checkboxChecked:false});
});
test('无勾选框的提醒不能写入记住选项',async()=>{
  let shown;const c=new Confirmations(request=>{shown=request;});const result=c.ask(options);
  c.answer(shown.id,{response:1,checkboxChecked:true});assert.equal((await result).checkboxChecked,false);
});
