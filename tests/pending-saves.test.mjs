import assert from "node:assert/strict";
import test from "node:test";
import {retainPendingSaves,restorePendingSaves} from "../.build/pocket/assets/pending-saves.js";

test("終了時には停止未確認IDと動画IDだけを残す",()=>{
  const jobs=[{videoId:"sm1",title:"PRIVATE_TITLE",sourceUrl:"PRIVATE_URL",saveIssue:{completed:{m4a:1},pendingDownloadId:2}},
    {videoId:"sm2",saveIssue:{completed:{m4a:3}}},{videoId:"sm3"}];
  assert.deepEqual(retainPendingSaves(undefined,jobs),[{videoId:"sm1",downloadId:2}]);
  assert.equal(JSON.stringify(retainPendingSaves(undefined,jobs)).includes("PRIVATE"),false);
});
test("複数回の終了・新規表示でも以前の未確認保存を維持する",()=>{
  const before=[{videoId:"sm1",downloadId:2}];
  const after=retainPendingSaves(before,[{videoId:"sm1",saveIssue:{pendingDownloadId:2}},
    {videoId:"sm1",saveIssue:{pendingDownloadId:4}}]);
  assert.deepEqual(after,[...before,{videoId:"sm1",downloadId:4}]);
  assert.deepEqual(retainPendingSaves(after,[]),after);
  assert.deepEqual(before,[{videoId:"sm1",downloadId:2}]);
});
test("不正な復旧情報を空の履歴として扱わない",()=>{
  for(const value of [null,{},[{videoId:123,downloadId:2}],[{videoId:"sm1",downloadId:-1}],
    [{videoId:"sm1",downloadId:2,filename:"PRIVATE_PATH"}],[{videoId:"sm1",downloadId:NaN}]]) {
    assert.throws(()=>restorePendingSaves(value));
  }
});
