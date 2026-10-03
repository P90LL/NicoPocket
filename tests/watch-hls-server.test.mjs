import assert from "node:assert/strict";
import test from "node:test";
import { WatchHlsServer } from "../.build/pocket/assets/watch-hls-server.js";
import { receiveHlsInput } from "../.build/pocket/assets/hls-transfer.js";

const event=()=>{const listeners=new Set();return{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),
  fire(value){for(const fn of [...listeners])fn(value);}};};
function ports(overrides={}){
  const pair=[0,1].map(()=>({onMessage:event(),onDisconnect:event(),messages:[],closed:false}));
  Object.assign(pair[0],{name:'nicopocket-hls:sm1:epoch-1:100',sender:{id:'own',url:'chrome-extension://own/window.html'}},overrides);
  pair.forEach((port,index)=>{
    port.postMessage=value=>{if(port.closed)throw new Error('Closed');const row=JSON.parse(JSON.stringify(value));port.messages.push(row);
      queueMicrotask(()=>{if(!pair[1-index].closed)pair[1-index].onMessage.fire(row);});};
    port.disconnect=()=>{if(port.closed)return;for(const p of pair)p.closed=true;
      // Chromeはdisconnectを呼んだ側のonDisconnectを発火しない。
      queueMicrotask(()=>{pair[1-index].onDisconnect.fire();});};
  });return pair;
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const tick=()=>new Promise(done=>setImmediate(done));
function fixture(acquire){
  const source={videoId:'sm1',epoch:'epoch-1'},calls=[];
  const server=new WatchHlsServer({extensionId:'own',windowUrl:'chrome-extension://own/window.html',currentSource:()=>({...source}),
    acquire:(...args)=>{calls.push(args);return acquire(...args);}});
  return{server,source,calls};
}
function input(){const bytes=new Uint8Array([1,7,9]);return{bytes,hls:{playlist:'#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nasset-0.bin\n#EXT-X-ENDLIST\n',
  files:[{name:'asset-0.bin',bytes}]},async dispose(){bytes.fill(0);}};}

test('同じ動画・世代の本体画面からだけ取得し、取得元消去後にバイト列を返す',async()=>{
  const owned=input(),f=fixture(async()=>owned),[sender,receiver]=ports();
  const received=receiveHlsInput(receiver,new AbortController().signal,100),sent=f.server.accept(sender);
  const result=await received;await sent;
  assert.deepEqual(f.calls[0][0],{videoId:'sm1',epoch:'epoch-1'});assert.equal(f.calls[0][2],100);
  assert(owned.bytes.every(n=>n===0));assert.deepEqual([...result.hls.files[0].bytes],[1,7,9]);await result.dispose();
});
test('別拡張機能・別画面・子frame・別動画・旧世代・不正上限は通信前に拒否する',async()=>{
  const f=fixture(async()=>{throw new Error('Must not acquire');});
  for(const overrides of [{sender:undefined},{sender:{id:'other',url:'chrome-extension://own/window.html',frameId:0}},
    {sender:{id:'own',url:'chrome-extension://own/licenses.html',frameId:0}},
    {sender:{id:'own',url:'chrome-extension://own/window.html',frameId:1}},
    {sender:{id:'own',url:'chrome-extension://own/window.html',tab:{url:'chrome-extension://own/window.html'}}},
    {sender:{id:'own',url:'chrome-extension://own/window.html',frameId:0,tab:{url:'https://untrusted.invalid/'}}},
    ...['nicopocket-hls:sm2:epoch-1:100','nicopocket-hls:sm1:old:100','nicopocket-hls:sm1:epoch-1:0',
      'nicopocket-hls:sm1:epoch-1:01','nicopocket-hls:sm1:epoch-1:9007199254740992',
      'nicopocket-hls:sm1:epoch-1:100:extra'].map(name=>({name}))]){
    const [port]=ports(overrides);await f.server.accept(port);assert(port.closed);
  }assert.equal(f.calls.length,0);
});
test('往復遷移でも取得を中断し、解放前の重複取得と旧世代を拒否する',async()=>{
  const loading=deferred(),owned=input();const f=fixture(async(_source,signal)=>{await loading.promise;assert(signal.aborted);return owned;});
  const [sender,receiver]=ports(),received=receiveHlsInput(receiver,new AbortController().signal,100),failed=assert.rejects(received);
  const sent=f.server.accept(sender);const [duplicate]=ports();await f.server.accept(duplicate);assert(duplicate.closed);
  f.source.videoId='sm2';f.source.epoch='epoch-2';const stopping=f.server.sourceChanged(f.source);
  await tick();f.source.videoId='sm1';f.source.epoch='epoch-3';
  const [duringCleanup]=ports({name:'nicopocket-hls:sm1:epoch-3:100'});await f.server.accept(duringCleanup);assert(duringCleanup.closed);
  loading.resolve();await stopping;await sent;await failed;assert(owned.bytes.every(n=>n===0));
  const [old]=ports();await f.server.accept(old);assert(old.closed);assert.equal(f.calls.length,1);
});
test('遷移通知と取得完了が競合しても別動画の入力を送らず消去する',async()=>{
  const loading=deferred(),owned=input(),f=fixture(async()=>{await loading.promise;return owned;});
  const [sender,receiver]=ports(),received=receiveHlsInput(receiver,new AbortController().signal,100),failed=assert.rejects(received);
  const sent=f.server.accept(sender);f.source.epoch='epoch-2';loading.resolve();await sent;await failed;
  assert(owned.bytes.every(n=>n===0));assert(!sender.messages.some(m=>m.kind==='manifest'||m.kind==='chunk'));
});
test('文書終了は取得を中止し、終了後の新規Portを拒否する',async()=>{
  const entered=deferred();let aborted=false;
  const f=fixture((_source,signal)=>new Promise((_,reject)=>{entered.resolve();signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});}));
  const [sender,receiver]=ports(),received=receiveHlsInput(receiver,new AbortController().signal,100),failed=assert.rejects(received);
  const sent=f.server.accept(sender);await entered.promise;await f.server.dispose();await sent;await failed;assert(aborted);
  const [next]=ports();await f.server.accept(next);assert(next.closed);assert.equal(f.calls.length,1);
});
test('確定上限を超える入力は返さず消去し、失敗後には次の取得を受け入れる',async()=>{
  let owned=input();const f=fixture(async()=>owned);
  const [sender,receiver]=ports({name:'nicopocket-hls:sm1:epoch-1:2'}),received=receiveHlsInput(receiver,new AbortController().signal,2);
  const failed=assert.rejects(received);await f.server.accept(sender);await failed;assert(owned.bytes.every(n=>n===0));
  owned=input();const [next,client]=ports(),success=receiveHlsInput(client,new AbortController().signal,100);
  const sent=f.server.accept(next),result=await success;await sent;await result.dispose();assert.equal(f.calls.length,2);
});
test('取得失敗の任意本文・署名URLをPortのエラーへ含めない',async()=>{
  const f=fixture(async()=>{throw new Error('sensitive-source-query');});
  const [sender,receiver]=ports(),received=receiveHlsInput(receiver,new AbortController().signal,100),failed=assert.rejects(received);
  await f.server.accept(sender);await failed;assert.deepEqual(sender.messages,[{kind:'end',status:'error',stopped:true}]);
  assert(!JSON.stringify(sender.messages).includes('sensitive-source-query'));
});
