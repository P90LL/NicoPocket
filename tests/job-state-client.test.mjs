import assert from "node:assert/strict";
import test from "node:test";
import { createJobStatePort } from "../.build/extension/pocket/assets/job-state-client.js";

const job = {id:"a",status:"processing",updatedAt:20,percent:0};
function runtime(t, handler) {
  const previous = globalThis.chrome;
  globalThis.chrome = {runtime:{sendMessage:handler}};
  t.after(() => { globalThis.chrome = previous; });
  return createJobStatePort();
}

test("読み出しと状態更新を送信し、時刻を呼び出し口で固定する", async (t) => {
  const messages=[];
  const port=runtime(t, async (message) => { messages.push(message); return {ok:true,job}; });
  assert.deepEqual(await port.get("a"), job);
  const before=Date.now();
  assert.deepEqual(await port.apply({type:"progress",id:"a",stage:"mux",percent:0,at:9e15}), job);
  assert.deepEqual(messages[0], {kind:"np:read-job",id:"a"});
  assert.equal(messages[1].kind,"np:apply-job-event");
  assert.equal(messages[1].event.stage,"mux");
  assert.ok(messages[1].event.at>=before && messages[1].event.at<=Date.now());
});

test("未登録は読み出しだけ許し、更新応答にはジョブを必須とする", async (t) => {
  const port=runtime(t, async () => ({ok:true}));
  assert.equal(await port.get("a"), undefined);
  await assert.rejects(port.apply({type:"start",id:"a",at:1}), /応答が正しくありません/);
});

test("応答の保存IDを検査・コピーし、不正な保存情報を拒否する", async (t) => {
  const downloads={m4a:11};let value={...job,downloads};
  const port=runtime(t,async()=>({ok:true,job:value}));
  const read=await port.get('a');downloads.m4a=12;
  assert.deepEqual(read.downloads,{m4a:11});
  value={...job,downloads:{m4a:11,url:'PRIVATE'}};
  await assert.rejects(port.get('a'),/応答が正しくありません/);
});

test("不正な識別子・自由本文は通信前に拒否する", async (t) => {
  let sent=0;
  const port=runtime(t, async () => {sent++;return {ok:true,job};});
  await assert.rejects(port.get("../a"));
  await assert.rejects(port.apply({type:"error",id:"a",code:"WORKER_FAILED",summary:"PRIVATE"}));
  assert.equal(sent,0);
});

test("別ジョブ、不正な状態・進捗・時刻、null応答を拒否する", async (t) => {
  let reply;
  const port=runtime(t, async () => reply);
  for (const value of [null, {...job,id:"b"}, {...job,status:"UNKNOWN"}, {...job,percent:101},
    {...job,percent:0.5}, {...job,updatedAt:NaN}]) {
    reply={ok:true,job:value};
    await assert.rejects(port.get("a"), /応答が正しくありません/);
  }
});

test("拒否応答や通信失敗の本文を呼び出し元へ露出しない", async (t) => {
  let reject=false;
  const port=runtime(t, async () => {
    if (reject) throw new Error("PRIVATE_URL_OR_TOKEN");
    return {ok:false,error:"PRIVATE_URL_OR_TOKEN"};
  });
  await assert.rejects(port.get("a"), {message:"実行状態を確認できませんでした。"});
  reject=true;
  await assert.rejects(port.apply({type:"cancel",id:"a",at:1}), {message:"実行状態を確認できませんでした。"});
});


test("部分保存と停止未確認のIDを検査・コピーし、任意本文を拒否する", async(t) => {
  const saveIssue = {completed:{m4a:1},pendingDownloadId:2};
  let value = {...job,status:"error",saveIssue};
  const port = runtime(t,async()=>({ok:true,job:value}));
  const read = await port.get("a"); saveIssue.completed.m4a=3;
  assert.deepEqual(read.saveIssue,{completed:{m4a:1},pendingDownloadId:2});
  for(const issue of [{},{pendingDownloadId:-1},{completed:{m4a:1},pendingDownloadId:1},
    {completed:{m4a:1},filename:"PRIVATE_PATH"}]) {
    value={...job,status:"error",saveIssue:issue};
    await assert.rejects(port.get("a"),/応答が正しくありません/);
  }
  let sent=0;
  const rejectPort=runtime(t,async()=>{sent++;return {ok:true,job};});
  await assert.rejects(rejectPort.apply({type:"cancel",id:"a",at:1,saveIssue:{pendingDownloadId:1}}));
  await assert.rejects(rejectPort.apply({type:"error",id:"a",at:1,code:"WORKER_FAILED",saveIssue:{completed:{m4a:1},pendingDownloadId:2}}));
  await assert.rejects(rejectPort.apply({type:"error",id:"a",at:1,code:"M4A_MUX_FAILED",saveIssue:{completed:{m4a:1}}}));
  assert.equal(sent,0);
  await rejectPort.apply({type:"error",id:"a",at:1,code:"WORKER_FAILED",saveIssue:{completed:{m4a:1}}});
  assert.equal(sent,1);
});
