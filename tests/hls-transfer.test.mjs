import assert from "node:assert/strict";
import test from "node:test";
import { sendHlsInput, receiveHlsInput } from "../.build/pocket/assets/hls-transfer.js";
import { copyLocalHlsInput, eraseLocalHlsInput } from "../.build/pocket/assets/hls-local-input.js";

const event = () => {
  const listeners=new Set();
  return { addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),
    fire(value){for(const fn of [...listeners])fn(value);},get size(){return listeners.size;} };
};
function ports(transform=(value)=>value){
  const pair=[0,1].map(()=>({onMessage:event(),onDisconnect:event(),messages:[],closed:false}));
  pair.forEach((port,index)=>{
    port.postMessage=value=>{
      if(port.closed)throw new Error("Disconnected");
      const json=JSON.parse(JSON.stringify(value));port.messages.push(json);
      queueMicrotask(()=>{if(!pair[1-index].closed)pair[1-index].onMessage.fire(transform(json,index));});
    };
    port.disconnect=()=>{if(port.closed)return;for(const p of pair)p.closed=true;
      queueMicrotask(()=>{for(const p of pair)p.onDisconnect.fire();});};
  });return pair;
}
const source=()=>({playlist:'#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nasset-0.bin\n#EXTINF:3,\nasset-1.bin\n#EXT-X-ENDLIST\n',
  files:[{name:"asset-0.bin",bytes:Uint8Array.from({length:100000},(_,i)=>i%251)},
    {name:"asset-1.bin",bytes:new Uint8Array([3,7,9])}]});
const tick=()=>new Promise(done=>setImmediate(done));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test("取得元自身の停止要求は相手の切断通知がなくてもACK待ちを解放する",async()=>{
  const [sender]=ports(),controller=new AbortController(),owned=source(),started=deferred();let disposed=false;
  const post=sender.postMessage;sender.postMessage=message=>{post(message);if(message.kind==='manifest')started.resolve();};
  const sent=sendHlsInput(sender,async()=>({hls:owned,async dispose(){eraseLocalHlsInput(owned);disposed=true;}}),200000,controller.signal);
  await started.promise;controller.abort();await sent;
  assert(disposed);assert(owned.files.every(f=>f.bytes.every(n=>n===0)));
  assert.equal(sender.messages.at(-1).status,'cancelled');assert.equal(sender.messages.at(-1).stopped,true);
  const [next]=ports(),already=new AbortController();already.abort();let calls=0;
  await sendHlsInput(next,async()=>{calls++;throw new Error('Must not acquire');},200000,already.signal);assert.equal(calls,0);
});

test("ChromeのJSON通信で固定サイズに分割し、送信側の解放後に独立したHLSを返す",async()=>{
  const [sender,receiver]=ports(),original=source(),owned=copyLocalHlsInput(original);let disposed=false;
  const received=receiveHlsInput(receiver,new AbortController().signal,200000);
  const sent=sendHlsInput(sender,async()=>({hls:owned,async dispose(){eraseLocalHlsInput(owned);disposed=true;}}),200000);
  const result=await received;await sent;
  assert(disposed);assert.deepEqual(result.hls.files,original.files);assert.equal(result.hls.playlist,owned.playlist);
  assert(owned.files.every(f=>f.bytes.every(n=>n===0)));
  assert(sender.messages.filter(m=>m.kind==="chunk").every(m=>m.text.length<=43692));
  assert.equal(sender.messages.filter(m=>m.kind==="chunk").length,5);
  assert.equal(receiver.messages.filter(m=>m.kind==="ack").length,6);
  await result.dispose();assert(result.hls.files.every(f=>f.bytes.every(n=>n===0)));
  assert(original.files[0].bytes.some(n=>n!==0));assert.equal(sender.onMessage.size,0);assert.equal(receiver.onMessage.size,0);
});

test("途中取消しでは取得入力の解放を待ち、受信成功を返さない",async()=>{
  const [sender,receiver]=ports(),controller=new AbortController(),cleanup=deferred(),entered=deferred(),owned=source();
  const received=receiveHlsInput(receiver,controller.signal,200000),check=assert.rejects(received,{name:"AbortError"});
  let settled=false;received.catch(()=>{settled=true;});
  receiver.onMessage.addListener(message=>{if(message.kind==="chunk")controller.abort();});
  const sent=sendHlsInput(sender,async()=>({hls:owned,async dispose(){entered.resolve();await cleanup.promise;eraseLocalHlsInput(owned);}}),200000);
  await entered.promise;await tick();assert.equal(settled,false);assert(owned.files[0].bytes.some(n=>n!==0));
  cleanup.resolve();await check;await sent;assert(owned.files.every(f=>f.bytes.every(n=>n===0)));
  assert.equal(sender.messages.at(-1).status,"cancelled");assert.equal(sender.messages.at(-1).stopped,true);
});

test("受信予算超過と順序不正では停止を要求し、取得元入力も片付ける",async()=>{
  for(const invalidSequence of [false,true]){
    const [sender,receiver]=ports((value,index)=>index===0&&invalidSequence&&value.kind==="chunk"?{...value,sequence:100}:value);
    const owned=source();let disposed=false;
    const received=receiveHlsInput(receiver,new AbortController().signal,invalidSequence?200000:100);
    const check=assert.rejects(received,/受け渡し/u);
    await sendHlsInput(sender,async()=>({hls:owned,async dispose(){eraseLocalHlsInput(owned);disposed=true;}}),200000);
    await check;assert(disposed);assert(owned.files.every(f=>f.bytes.every(n=>n===0)));
    assert.equal(receiver.messages.at(-1).kind,"cancel");assert.equal(sender.messages.at(-1).stopped,true);
  }
});

test("取得中に受信画面が閉じたら取得を中断し、後片付け後に監視を外す",async()=>{
  const [sender,receiver]=ports(),entered=deferred();let aborted=false;
  const sent=sendHlsInput(sender,signal=>new Promise((_,reject)=>{
    entered.resolve();signal.addEventListener("abort",()=>{aborted=true;reject(signal.reason);},{once:true});
  }),200000);
  await entered.promise;receiver.disconnect();await sent;
  assert(aborted);assert.equal(sender.onMessage.size,0);assert.equal(sender.onDisconnect.size,0);
  assert.equal(sender.messages.length,0);
});

test("解放失敗は正常中断へ置き換えず、停止応答が来ない場合だけ期限を適用する",async context=>{
  const [sender,receiver]=ports(),controller=new AbortController();
  const received=receiveHlsInput(receiver,controller.signal,200000),check=assert.rejects(received,/受け渡し/u);
  receiver.onMessage.addListener(message=>{if(message.kind==="manifest")controller.abort();});
  await sendHlsInput(sender,async()=>({hls:source(),async dispose(){throw new Error("sensitive source text");}}),200000);
  await check;assert.equal(sender.messages.at(-1).status,"error");
  assert(!JSON.stringify(sender.messages).includes("sensitive source text"));
  context.mock.timers.enable({apis:["setTimeout"]});
  const [remote,client]=ports(),cancel=new AbortController(),pending=receiveHlsInput(client,cancel.signal,200000);
  const timed=assert.rejects(pending,/停止を確認/u);
  context.mock.timers.tick(300000);assert.equal(client.closed,false);
  cancel.abort();context.mock.timers.tick(4999);assert.equal(client.closed,false);
  context.mock.timers.tick(1);await timed;assert.equal(client.closed,true);assert.equal(remote.closed,true);
});
