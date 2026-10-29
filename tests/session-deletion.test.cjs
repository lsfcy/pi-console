const test=require('node:test'),assert=require('node:assert/strict');
const {createSessionController}=require('../build/main/session-controller.cjs');
function fixture(response=1){
  const info={file:'/project/saved.jsonl',key:'key',id:'session',title:'Saved'},calls=[];
  let owner={id:'terminal',runId:'run',sessionId:info.id,sessionKey:info.key},path='/project',stopError;
  const c=createSessionController({
    projects:{get:()=>({id:'p',path}),keep:()=>calls.push('keep')},
    terminals:{findSession:()=>owner,sessionBusy:()=>owner,current:(id,run)=>owner?.id===id&&owner?.runId===run?{state:owner}:null,
      stop:async()=>{calls.push('stop');if(stopError)throw stopError;owner=null;}},
    catalog:{lookup:async()=>info,cache:new Map()},
    confirm:async options=>{calls.push(options);return {response,checkboxChecked:false};},
    refreshLibrary:async()=>{calls.push('refresh');return {};},snapshot:()=>({}),
    trashItem:async()=>calls.push('trash')
  });
  return {c,calls,setOwner:value=>owner=value,setPath:value=>path=value,setStopError:value=>stopError=value};
}
test('删除运行中会话先明确确认，再等待进程停止，最后移到废纸篓',async()=>{
  const {c,calls}=fixture();await c.deleteSession('p','key');
  assert.match(calls[1].message,/关闭并删除/);assert.match(calls[1].detail,/未完成任务会中断/);
  assert(calls.indexOf('stop')<calls.indexOf('trash'));assert(calls.includes('trash'));
});
test('取消删除不停止进程、不移动历史、不改变项目',async()=>{
  const {c,calls}=fixture(0);await c.deleteSession('p','key');
  for(const action of ['stop','trash','keep'])assert(!calls.includes(action));
});
test('进程停止失败时禁止删除历史',async()=>{
  const {c,calls,setStopError}=fixture();setStopError(Error('stop failed'));
  await assert.rejects(c.deleteSession('p','key'),/stop failed/);assert(!calls.includes('trash'));
});
test('确认等待期间目录更换或标签切换时不删除，不误停新会话',async()=>{
  for(const mutate of [f=>f.setPath('/different'),f=>f.setOwner({id:'other',runId:'new'}),f=>f.setOwner({id:'terminal',runId:'run',sessionId:'new',sessionKey:'other'})]) {
    const f=fixture();const pending=f.c.deleteSession('p','key');
    // The async lookup completes before the confirmation continuation.
    await Promise.resolve();await Promise.resolve();mutate(f);
    await assert.rejects(pending,/变更|重新打开|切换/);
    assert(!f.calls.includes('trash'));assert(!f.calls.includes('stop'));
  }
});
