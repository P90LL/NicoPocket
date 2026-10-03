import assert from "node:assert/strict";
import test from "node:test";
import { saveLocalFiles, NICOPOCKET_DOWNLOAD_FOLDER, DownloadSaveError, DownloadSaveAborted } from "../.build/pocket/assets/download-saver.js";

const file=(name="test.m4a")=>({filename:name,blob:new Blob([new Uint8Array([1,2,3])],{type:"application/octet-stream"})});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise((done)=>setTimeout(done,0));
function harness(t, overrides={}) {
  const previous=globalThis.chrome, create=URL.createObjectURL, revoke=URL.revokeObjectURL;
  const listeners=new Set(), created=[], revoked=[], started=[], cancelled=[];
  let next=1;
  const api={
    onChanged:{addListener:(listener)=>listeners.add(listener),removeListener:(listener)=>listeners.delete(listener)},
    download:async (options)=>{started.push(options);return next++;},
    search:async ({id})=>[{id,state:"in_progress"}],
    cancel:async (id)=>{cancelled.push(id);},...overrides
  };
  globalThis.chrome={runtime:{id:'test-extension'},downloads:api};
  URL.createObjectURL=(blob)=>{const url='blob:local-'+created.length;created.push({url,blob});return url;};
  URL.revokeObjectURL=(url)=>revoked.push(url);
  t.after(()=>{globalThis.chrome=previous;URL.createObjectURL=create;URL.revokeObjectURL=revoke;});
  return {api,listeners,created,revoked,started,cancelled,
    emit:(id,state)=>{for(const listener of listeners) listener({id,state:{current:state}});}};
}

test("保存IDの保持応答を待ち、先に届いた完了通知を失わず終了後に解除する", async t => {
  const h = harness(t), retained = deferred(), calls = [];
  const saving = saveLocalFiles([file(), file('test.aac')], new AbortController().signal, undefined, false, {
    async started(id) { calls.push(['retain', id]); if (id === 1) await retained.promise; },
    async finished(id) { calls.push(['release', id]); }
  });
  await tick(); assert.equal(h.started.length, 1); assert.deepEqual(calls, [['retain', 1]]);
  h.emit(1, 'complete'); retained.resolve(); await tick();
  h.emit(2, 'complete'); assert.equal((await saving).length, 2);
  assert.deepEqual(calls, [['retain', 1], ['release', 1], ['retain', 2], ['release', 2]]);
  assert.equal(h.listeners.size, 0); assert.equal(h.revoked.length, 2);
});

test("保持失敗は開始済み保存を停止し、後続を開始せず内部エラーを返さない", async t => {
  const h = harness(t), released = [];
  await assert.rejects(saveLocalFiles([file(), file('test.aac')], new AbortController().signal, undefined, false, {
    async started() { throw new Error('PRIVATE_STORAGE_DETAIL'); }, async finished(id) { released.push(id); }
  }), error => error instanceof DownloadSaveError && error.cancellationConfirmed
    && !String(error).includes('PRIVATE') && error.pendingDownloadId === undefined);
  assert.deepEqual(h.cancelled, [1]); assert.deepEqual(released, [1]); assert.equal(h.started.length, 1);
  assert.equal(h.listeners.size, 0); assert.equal(h.revoked.length, 1);
});

test("終了記録の解除失敗は未確認IDを保持し、完了IDと二重計上しない", async t => {
  const h = harness(t, { search: async ({ id }) => [{ id, state: 'complete' }] });
  await assert.rejects(saveLocalFiles([file(), file('test.aac')], new AbortController().signal, undefined, false, {
    async started() {}, async finished() { throw new Error('PRIVATE_STORAGE_DETAIL'); }
  }), error => error instanceof DownloadSaveError && !error.cancellationConfirmed
    && error.pendingDownloadId === 1 && error.completed.length === 0);
  assert.equal(h.started.length, 1); assert.equal(h.listeners.size, 0); assert.equal(h.revoked.length, 1);
});

test("保持後の停止API失敗は解除せず、そのIDを復旧情報として返す", async t => {
  const controller = new AbortController(), retained = [], released = [];
  const h = harness(t, { cancel: async () => { throw new Error('cancel failed'); } });
  const saving = saveLocalFiles([file()], controller.signal, undefined, false, {
    async started(id) { retained.push(id); controller.abort(); }, async finished(id) { released.push(id); }
  });
  await assert.rejects(saving, error => error instanceof DownloadSaveError && error.pendingDownloadId === 1
    && !error.cancellationConfirmed);
  assert.deepEqual(retained, [1]); assert.deepEqual(released, []); assert.equal(h.listeners.size, 0);
});

test("ID応答前の取消しは、永続保持の応答待ちでもChrome停止を遅らせない", async t => {
  const controller = new AbortController(), idReady = deferred(), journalReady = deferred();
  const h = harness(t, { download: async () => idReady.promise });
  const saving = saveLocalFiles([file()], controller.signal, undefined, false, {
    async started() { await journalReady.promise; }, async finished() {}
  });
  controller.abort(); idReady.resolve(1); await tick();
  assert.deepEqual(h.cancelled, [1]); journalReady.resolve();
  await assert.rejects(saving, error => error.name === 'AbortError'); assert.equal(h.listeners.size, 0);
});

test("専用フォルダーへ保存し、照合結果には末端ファイル名だけを返す", async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:'/temporary/'+h.started[id-1].filename}]});
  const saved=await saveLocalFiles([file('音声(2).m4a'),file('音声(2).aac'),file('音声(2).jpg')],
    new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER);
  assert.deepEqual(h.started.map(options=>options.filename),['NicoPocket/音声(2).m4a','NicoPocket/音声(2).aac','NicoPocket/音声(2).jpg']);
  assert.deepEqual(saved.map(item=>item.requestedFilename),['音声(2).m4a','音声(2).aac','音声(2).jpg']);
  assert.ok(h.started.every(options=>options.conflictAction==='uniquify'&&!Object.hasOwn(options,'saveAs')));
  assert.equal(h.revoked.length,3);assert.equal(h.listeners.size,0);
});

test("任意の保存先・パストラバーサル指定はBlob URL生成前に拒否する",async(t)=>{
  const h=harness(t);
  for(const directory of ['',null,'Other','../NicoPocket','/NicoPocket','NicoPocket/../Other','NicoPocket/job']) {
    await assert.rejects(saveLocalFiles([file()],new AbortController().signal,directory),DownloadSaveError);
  }
  assert.equal(h.started.length,0);assert.equal(h.created.length,0);
});

test("AACだけがChromeの別名になったら、2保存IDを保持してJPEGを開始しない",async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:'/temporary/NicoPocket/'+(id===2?'title (1).aac':'title.m4a')}]});
  await assert.rejects(saveLocalFiles([file('title.m4a'),file('title.aac'),file('title.jpg')],
    new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER),error=>{
      assert.ok(error instanceof DownloadSaveError);
      assert.deepEqual(error.completed,[{id:1,requestedFilename:'title.m4a'},{id:2,requestedFilename:'title.aac'}]);
      assert.equal(error.pendingDownloadId,undefined);return true;
    });
  assert.equal(h.started.length,2);assert.equal(h.revoked.length,2);assert.equal(h.listeners.size,0);
});

test("保存確認で親フォルダーが変わった結果を同一フォルダーの成功にしない",async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:(id===1?'/first':'/second')+'/NicoPocket/title.'+(id===1?'m4a':'aac')}]});
  await assert.rejects(saveLocalFiles([file('title.m4a'),file('title.aac')],
    new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER),error=>{
      assert.deepEqual(error.completed.map(x=>x.id),[1,2]);
      assert.doesNotMatch(JSON.stringify(error),/\/first|\/second/);return true;
    });
});

test("最初のM4A指定名を後続へ引き継ぎ、呼出し元の名前とBlobを変更しない",async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:'/temporary/NicoPocket/'+(id===1?'変更済み.m4a':h.started[id-1].filename.split('/').at(-1))}]});
  const files=[file('title.m4a'),file('title.aac'),file('title.jpg')];
  const saved=await saveLocalFiles(files,new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER,true);
  assert.deepEqual(h.started.map(x=>x.filename),['NicoPocket/title.m4a','NicoPocket/変更済み.aac','NicoPocket/変更済み.jpg']);
  assert.deepEqual(saved.map(x=>x.requestedFilename),['変更済み.m4a','変更済み.aac','変更済み.jpg']);
  assert.deepEqual(files.map(x=>x.filename),['title.m4a','title.aac','title.jpg']);
  assert.deepEqual(await Promise.all(h.created.map(async x=>[...new Uint8Array(await x.blob.arrayBuffer())])),[[1,2,3],[1,2,3],[1,2,3]]);
  assert.equal(h.revoked.length,3);assert.equal(h.listeners.size,0);
});

test("改名後のAACが別名なら完了IDを保持し、JPEGを開始しない",async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:'/temporary/NicoPocket/'+(id===1?'変更済み.m4a':'変更済み (1).aac')}]});
  await assert.rejects(saveLocalFiles([file('title.m4a'),file('title.aac'),file('title.jpg')],
    new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER,true),error=>{
      assert.deepEqual(error.completed,[{id:1,requestedFilename:'変更済み.m4a'},{id:2,requestedFilename:'変更済み.aac'}]);return true;
    });
  assert.equal(h.started.length,2);assert.equal(h.revoked.length,2);assert.equal(h.listeners.size,0);
});

test("200バイトのタイトルに付いた共通連番も指定名として引き継ぐ",async(t)=>{
  const stem='a'.repeat(200)+'(12)';
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:'/temporary/NicoPocket/'+(id===1?stem+'.m4a':h.started[id-1].filename.split('/').at(-1))}]});
  const saved=await saveLocalFiles([file('title.m4a'),file('title.aac')],new AbortController().signal,
    NICOPOCKET_DOWNLOAD_FOLDER,true);
  assert.deepEqual(saved.map(x=>x.requestedFilename),[stem+'.m4a',stem+'.aac']);
});

test("自動衝突名・不正な指定名・拡張子変更・相対パスは最初のIDを保持して停止",async(t)=>{
  const h=harness(t);
  for(const path of ['/temporary/NicoPocket/title (1).m4a','/temporary/NicoPocket/.hidden.m4a',
    '/temporary/NicoPocket/CON.m4a','/temporary/NicoPocket/changed.mp4','relative/変更済み.m4a']){
    let calls=0;
    h.api.download=async()=>++calls;
    h.api.search=async({id})=>[{id,state:'complete',byExtensionId:'test-extension',filename:path}];
    await assert.rejects(saveLocalFiles([file('title.m4a'),file('title.aac')],new AbortController().signal,
      NICOPOCKET_DOWNLOAD_FOLDER,true),error=>{
        assert.ok(error instanceof DownloadSaveError);assert.deepEqual(error.completed,[{id:1,requestedFilename:'title.m4a'}]);
        assert.doesNotMatch(JSON.stringify(error),/temporary|Other/);return true;
      });
    assert.equal(calls,1);
  }
});

test("製品ジョブは最初に選んだ親へ3形式が揃えば完了し、パスを返さない",async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:'/selected/Other/'+h.started[id-1].filename.split('/').at(-1)}]});
  const saved=await saveLocalFiles([file('title.m4a'),file('title.aac'),file('title.jpg')],
    new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER,true);
  assert.deepEqual(saved.map(x=>x.requestedFilename),['title.m4a','title.aac','title.jpg']);
  assert.doesNotMatch(JSON.stringify(saved),/selected|Other/);
  assert.ok(h.started.every(x=>x.filename.startsWith('NicoPocket/')&&!Object.hasOwn(x,'saveAs')));
});

test("選択先から後続だけ別の親になったらID2件を保持し、JPEGを開始しない",async(t)=>{
  const h=harness(t,{search:async({id})=>[{id,state:'complete',byExtensionId:'test-extension',
    filename:(id===1?'/selected/Other/':'/different/Other/')+h.started[id-1].filename.split('/').at(-1)}]});
  await assert.rejects(saveLocalFiles([file('title.m4a'),file('title.aac'),file('title.jpg')],
    new AbortController().signal,NICOPOCKET_DOWNLOAD_FOLDER,true),error=>{
      assert.deepEqual(error.completed.map(x=>x.id),[1,2]);assert.doesNotMatch(JSON.stringify(error),/selected|different/);return true;
    });
  assert.equal(h.started.length,2);
});

test("指定名引継ぎは共通幹のM4A先頭の製品グループだけで許可する",async(t)=>{
  const h=harness(t);
  for(const [files,directory] of [[[file('title.aac')],NICOPOCKET_DOWNLOAD_FOLDER],
    [[file('title.m4a'),file('other.jpg')],NICOPOCKET_DOWNLOAD_FOLDER],[[file('title.m4a')],undefined]]){
    await assert.rejects(saveLocalFiles(files,new AbortController().signal,directory,true),DownloadSaveError);
  }
  assert.equal(h.started.length,0);assert.equal(h.created.length,0);
});

test("全ファイルの完了まで待ち、Chrome設定を維持し、URL・監視を解除する", async(t)=>{
  const h=harness(t), files=[file(),file('test.aac'),file('test.jpg')];
  let finished=false;
  const saving=saveLocalFiles(files,new AbortController().signal).then((result)=>{finished=true;return result;});
  await tick();
  assert.equal(h.started.length,1);assert.equal(finished,false);assert.equal(h.revoked.length,0);
  h.emit(99,'complete');await tick();assert.equal(h.started.length,1);
  h.emit(1,'complete');await tick();assert.equal(h.started.length,2);assert.equal(finished,false);
  h.emit(2,'complete');await tick();assert.equal(h.started.length,3);assert.equal(finished,false);
  h.emit(3,'complete');
  assert.deepEqual(await saving,[{id:1,requestedFilename:'test.m4a'},{id:2,requestedFilename:'test.aac'},{id:3,requestedFilename:'test.jpg'}]);
  assert.ok(h.started.every((options)=>!Object.hasOwn(options,'saveAs') && options.conflictAction==='uniquify'));
  assert.equal(h.revoked.length,3);assert.equal(h.listeners.size,0);
});

test("開始応答前に完了した小さなBlobをsearchで拾う", async(t)=>{
  const h=harness(t,{search:async ({id})=>[{id,state:'complete'}]});
  assert.equal((await saveLocalFiles([file()],new AbortController().signal))[0].id,1);
  assert.equal(h.revoked.length,1);assert.equal(h.listeners.size,0);
});

test("状態検索中の完了イベントが古い検索結果より優先される", async(t)=>{
  const read=deferred(),h=harness(t,{search:()=>read.promise});
  const saving=saveLocalFiles([file()],new AbortController().signal);
  await tick();h.emit(1,'complete');read.resolve([{id:1,state:'in_progress'}]);
  assert.equal((await saving)[0].id,1);assert.equal(h.cancelled.length,0);
});

test("部分成功後の中断は残りを開始せず、保存済みIDと固定エラーだけを返す", async(t)=>{
  const h=harness(t);
  const saving=saveLocalFiles([file(),file('test.aac'),file('test.jpg')],new AbortController().signal);
  const rejection=assert.rejects(saving,(error)=>{
    assert.ok(error instanceof DownloadSaveError);
    assert.deepEqual(error.completed,[{id:1,requestedFilename:'test.m4a'}]);
    assert.equal(error.code,'DOWNLOAD_FAILED');return true;
  });
  await tick();h.emit(1,'complete');await tick();h.emit(2,'interrupted');await rejection;
  assert.equal(h.started.length,2);assert.equal(h.revoked.length,2);assert.equal(h.listeners.size,0);
});

test("開始ID応答前の中断はIDとChromeの停止応答を待ってから片付ける", async(t)=>{
  const start=deferred(),stop=deferred(),controller=new AbortController();
  const h=harness(t,{download:()=>start.promise,cancel:(id)=>{h.cancelled.push(id);return stop.promise;}});
  let finished=false;
  const saving=saveLocalFiles([file(),file('test.aac')],controller.signal).finally(()=>{finished=true;});
  const rejected=assert.rejects(saving,{name:'AbortError'});
  controller.abort();await tick();assert.equal(finished,false);assert.equal(h.revoked.length,0);
  start.resolve(7);await tick();assert.deepEqual(h.cancelled,[7]);assert.equal(finished,false);
  h.emit(7,'interrupted');await tick();assert.equal(finished,false);assert.equal(h.revoked.length,0);
  stop.resolve();await rejected;assert.equal(h.revoked.length,1);assert.equal(h.listeners.size,0);
});

test("状態確認失敗は開始した保存の停止を待ち、例外本文を露出しない", async(t)=>{
  const stop=deferred();
  const h=harness(t,{search:async ()=>{throw new Error('PRIVATE_INPUT');},cancel:(id)=>{h.cancelled.push(id);return stop.promise;}});
  const saving=saveLocalFiles([file()],new AbortController().signal);
  const rejected=assert.rejects(saving,(error)=>{assert.equal(error.message,'ファイルの保存に失敗しました。');return true;});
  await tick();assert.deepEqual(h.cancelled,[1]);assert.equal(h.revoked.length,0);
  stop.resolve();await rejected;assert.equal(h.revoked.length,1);assert.equal(h.listeners.size,0);
});

test("保存開始拒否は固定エラーへ変え、URLと監視を解放する", async(t)=>{
  const h=harness(t,{download:async ()=>{throw new Error('PRIVATE_START');}});
  await assert.rejects(saveLocalFiles([file()],new AbortController().signal),
    {message:'ファイルの保存に失敗しました。',code:'DOWNLOAD_FAILED'});
  assert.equal(h.cancelled.length,0);assert.equal(h.revoked.length,1);assert.equal(h.listeners.size,0);
});

test("停止APIの失敗は停止確認済みや正常キャンセルとして報告しない", async(t)=>{
  const h=harness(t,{cancel:async ()=>{throw new Error('PRIVATE_CANCEL');}}),controller=new AbortController();
  const saving=saveLocalFiles([file()],controller.signal);
  const rejected=assert.rejects(saving,(error)=>{assert.ok(error instanceof DownloadSaveError);assert.equal(error.cancellationConfirmed,false);assert.equal(error.pendingDownloadId,1);return true;});
  await tick();controller.abort();await rejected;assert.equal(h.listeners.size,0);assert.equal(h.revoked.length,1);
});

test("不正な名前・空データ・重複名・事前中断は保存を開始しない", async(t)=>{
  const h=harness(t);
  for(const files of [[],[file('../test.m4a')],[file('/test.m4a')],[file('')],[{filename:'test.m4a',blob:new Blob()}],[file(),file()]]) {
    await assert.rejects(saveLocalFiles(files,new AbortController().signal),DownloadSaveError);
  }
  const controller=new AbortController();controller.abort();
  await assert.rejects(saveLocalFiles([file()],controller.signal),{name:'AbortError'});
  assert.equal(h.started.length,0);assert.equal(h.created.length,0);
});


test("完了イベントとキャンセルが競合しても、完了済み保存IDを失わない", async(t)=>{
  const read=deferred(),controller=new AbortController(),h=harness(t,{search:()=>read.promise});
  const saving=saveLocalFiles([file()],controller.signal);
  const rejected=assert.rejects(saving,(error)=>{
    assert.ok(error instanceof DownloadSaveAborted);
    assert.deepEqual(error.completed,[{id:1,requestedFilename:"test.m4a"}]);
    return true;
  });
  await tick();h.emit(1,"complete");controller.abort();read.resolve([{id:1,state:"in_progress"}]);
  await rejected;
  assert.equal(h.cancelled.length,0);
  assert.equal(h.listeners.size,0);assert.equal(h.revoked.length,1);
});

test("停止要求後に完了が確認できた場合、停止API拒否だけで停止未確認にはしない", async(t)=>{
  const stop=deferred(),controller=new AbortController(),h=harness(t,{cancel:()=>stop.promise});
  const saving=saveLocalFiles([file()],controller.signal);
  const rejected=assert.rejects(saving,(error)=>{
    assert.ok(error instanceof DownloadSaveAborted);
    assert.deepEqual(error.completed,[{id:1,requestedFilename:"test.m4a"}]);return true;
  });
  await tick();controller.abort();h.emit(1,"complete");stop.reject(new Error("PRIVATE_STOP"));
  await rejected;assert.equal(h.listeners.size,0);assert.equal(h.revoked.length,1);
});
