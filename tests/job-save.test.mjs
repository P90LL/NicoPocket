import assert from "node:assert/strict";
import test from "node:test";
import { prepareJobSaveFiles, saveJobMedia } from "../.build/pocket/assets/job-save.js";
import { outputNames } from "../.build/pocket/assets/filename.js";
import { DownloadSaveError } from "../.build/pocket/assets/download-saver.js";

const output=()=>({m4a:new Uint8Array([1]),aac:new Uint8Array([2]),jpeg:new Uint8Array([3]),warning:false,warnings:[]});
test("ジョブ保存は専用フォルダーを指定し、選択した3成果物の内容を維持する",async(t)=>{
  const previous=globalThis.chrome,started=[],listeners=new Set();
  globalThis.chrome={runtime:{id:'job-save-test'},downloads:{
    onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},
    download:async options=>{started.push({options,bytes:[...new Uint8Array(await(await fetch(options.url)).arrayBuffer())]});return started.length;},
    search:async({id})=>[{id,state:'complete',byExtensionId:'job-save-test',
      filename:'C:\\Temporary\\'+started[id-1].options.filename.replaceAll('/','\\')}],cancel:async()=>{}
  }};
  t.after(()=>{globalThis.chrome=previous;});
  const job={saveAac:true,saveJpeg:true},names=outputNames('title','sm1',1,true,true);
  const saved=await saveJobMedia(job,output(),names,new AbortController().signal);
  assert.deepEqual(started.map(x=>x.options.filename),['NicoPocket/title(1).m4a','NicoPocket/title(1).aac','NicoPocket/title(1).jpg']);
  assert.deepEqual(started.map(x=>x.bytes),[[1],[2],[3]]);
  assert.deepEqual(saved,[{id:1,requestedFilename:'title(1).m4a'},{id:2,requestedFilename:'title(1).aac'},{id:3,requestedFilename:'title(1).jpg'}]);
  assert.equal(listeners.size,0);
});
test("登録時の選択と同じ連番の名前からM4Aと必要な任意成果物を作る", async()=>{
  for(const saveAac of [false,true]) for(const saveJpeg of [false,true]) {
    const files=prepareJobSaveFiles({saveAac,saveJpeg},output(),outputNames('登録タイトル','sm1',2,saveAac,saveJpeg));
    assert.deepEqual(files.map((file)=>file.filename),['登録タイトル(2).m4a',...(saveAac?['登録タイトル(2).aac']:[]),...(saveJpeg?['登録タイトル(2).jpg']:[])]);
    assert.deepEqual(files.map((file)=>file.blob.type),['application/octet-stream',...(saveAac?['audio/aac']:[]),...(saveJpeg?['image/jpeg']:[])]);
    assert.equal(files[0].blob.size,1);
  }
});
test("選択した成果物の欠損や異なる連番・拡張子・パスを保存前に拒否する",()=>{
  const job={saveAac:true,saveJpeg:true},names=outputNames('title','sm1',1,true,true);
  for(const [media,files] of [[{...output(),m4a:new Uint8Array()},names],
    [{...output(),aac:undefined},names],[{...output(),jpeg:undefined},names],
    [output(),{...names,aac:'title(2).aac'}],[output(),{...names,jpeg:'title(1).jpeg'}],
    [output(),{...names,m4a:'../title(1).m4a'}],[output(),{...names,m4a:'title(1).mp4'}]]) {
    assert.throws(()=>prepareJobSaveFiles(job,media,files),DownloadSaveError);
  }
});
test("登録画像なしの警告継続ではJPEGを省略し、登録画像の欠損は隠さない",()=>{
  const media={...output(),jpeg:undefined,warning:true,warnings:['COVER_UNAVAILABLE']};
  const names=outputNames('title','sm1',0,true,true),job={saveAac:true,saveJpeg:true};
  assert.deepEqual(prepareJobSaveFiles(job,media,names).map((file)=>file.filename),['title.m4a','title.aac']);
  assert.throws(()=>prepareJobSaveFiles({...job,thumbnail:{}},media,names),DownloadSaveError);
});
test("保存準備後の出力バイトや候補設定変更がBlobと保存選択を変えない",async()=>{
  const media=output(),job={saveAac:true,saveJpeg:true},names=outputNames('title','sm1',0,true,true);
  const files=prepareJobSaveFiles(job,media,names);
  media.m4a.fill(0);media.aac.fill(0);media.jpeg.fill(0);job.saveAac=false;job.saveJpeg=false;names.m4a='changed.m4a';
  assert.deepEqual(await Promise.all(files.map(async(file)=>[...new Uint8Array(await file.blob.arrayBuffer())])),[[1],[2],[3]]);
  assert.equal(files[0].filename,'title.m4a');assert.equal(files.length,3);
});
