# Phase 3: NicoPocket Downloadから既存AAC保存へ接続

実装日: 2026-10-06

## 実装内容と変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/manifest.json` | AAC接続アダプターを登録。既存保存の完了・中断監視のためdownloads権限を追加。 |
| `nico_downloader/nicovideodownloader_scripts.js` | VideoDownへ任意の取得元チェックを追加。JSON・設定取得の待機後と取得開始前に照合。通常呼び出しは従来どおり。 |
| `nico_downloader/pocket/aac-bridge.js` | 既存処理の呼び出し、AACモード・保存名の受け渡し、システムメッセージ表示、状態通知、終了・失敗検出、取得元変更時の中断を接続。 |
| `nico_downloader/pocket/background.js` | 編集画面の要求を検証して取得元タブへ送信。単一ジョブと、既存Blob保存のChrome download IDを管理。 |
| `nico_downloader/pocket/content.js` | 取得処理中に既存の進捗用ボタンを再配置しないよう調整。 |
| `nico_downloader/pocket/window.html` | 保存予定拡張子を.aacへ変更。 |
| `nico_downloader/pocket/window.js` | Downloadを有効化。処理中の無効化、状態表示、終了・失敗後の操作復帰を実装。 |
| `PHASE3.md` | 実装・検証・実機確認・Phase 4の接続箇所を記録。 |

## 再利用した既存処理とデータフロー

```text
NicoPocket Download
  → 表示中の動画ID・動画URL・取得元タブIDを照合
  → 取得元タブへ明示的なAAC実行要求
  → 現在のwatchパスと動画IDを再照合
  → 既存 VideoDown()
  → 既存 MovieDownload_domand()
  → 既存 DownEncoder()
  → 既存 Transcode() / runFFmpeg_m3u8()
  → 既存のAAC Blob・downloadlink生成
  → 既存 NicoDownloaderClass.DownloadLinkClick()
  → Chromeのdownload IDで保存完了・中断を監視
  → 編集画面と取得元タブの処理中状態を解除
```

`NicovideoClass`、`NicoDownloaderClass`、既存のJSON取得・HLS解析・セグメント取得・FFmpeg・Blob生成・保存リンククリックを再利用します。`func/nicojson.js`、`func/ndl.js`、`dist/utils.js`、FFmpeg core・Wasmは変更していません。

接続アダプターは元の関数を保持して呼び出すラッパーです。NicoPocket要求中だけAACモードを選び、保存名を渡し、終了やエラーを監視します。要求外では元の処理へ委譲します。取得ロジックやFFmpeg引数を複製していません。元から含まれているFFmpeg metadata引数も変更していません。

## タイトルと音質の扱い

編集後タイトルを `NicoPocketTitle.normalize()` で正規化し、`編集タイトル.aac` として既存の保存名生成箇所へ渡します。FFmpeg用の動画タイトルなどは元の値のままです。

NicoPocket要求中は、既存の形式選択関数へAACを返します。ユーザーのstorage.localに保存されている元の形式設定は書き換えません。標準音質／高音質の値は取得処理へ渡さず、品質分岐を追加していません。

## 二重実行・取得元整合性・復帰

- UIのクリック直後にロックし、処理中はDownload・タイトル・音質の操作を無効化。
- 既存のbackground内で全タブ共通の単一ジョブを保持し、同時要求を拒否。
- 取得元タブ内でも単一実行を保証。
- Phase 2の取得元情報と要求を照合し、実行するタブのwatchパスも照合。
- JSON待機後、設定取得後、プレイリスト取得後、FFmpeg実行前、保存リンククリック前にも取得元を確認。
- 動画切替・タブ終了・開始失敗・プレイリスト失敗・AAC取得失敗・FFmpeg失敗・保存中断時はエラーを表示し、操作を復帰。
- 元のセグメント取得にAbortSignalを渡し、中断後の再試行を入口で止める。HLS取得の実装は維持し、結果受領後に整合性を再確認。
- Chromeのsession storageはcontent scriptに公開せず、終了通知は既存メッセージ経路で渡す。
- 保存監視は当該ジョブのBlob URLと一致するdownload IDだけを追跡。ダウンロード履歴のファイル名・絶対パスをUI状態へ保存しない。
- 配信元確認は15秒、保存開始確認は60秒、全体は30分の上限を設定。実行中の長い処理はこの上限に達するとエラーとなる。

## 検証結果

実リポジトリを一時プロファイルのChromeへ直接読み込み、動画JSONと配信応答のみローカルの合成データへ置き換えて確認しました。

- 元のHLS解析・セグメント取得・同梱FFmpeg/Wasm・Blob生成・保存リンククリックを実際に実行。
- 編集したUnicodeタイトルが正規化され、AAC保存名へ反映されることを確認。
- 保存ファイルをffprobeで検査し、AAC-LCの音声であることを確認。
- 二重クリックで取得が1回だけ開始することを確認。
- 保存完了後にDownloadが再度操作可能になることを確認。
- 表示後に動画が切り替わった場合、古い動画の取得が拒否されることを確認。
- 別動画を開き直した後、その動画のAACを保存できることを確認。
- プレイリスト取得中に別動画へ切り替えると古い処理が中断され、次の動画で再実行できることを確認。
- プレイリスト失敗・FFmpeg失敗の後にUIが復帰し、再試行でAACを保存できることを確認。
- 取得元タブが閉じられた場合のエラー復帰を確認。
- 元の保存形式設定がMP4でも、NicoPocketのAAC保存後にその設定が変更されていないことを確認。

意図的に壊したプレイリストでは、既存処理の例外ログも残ります。接続側は失敗を表示してUIを復帰します。ログ自体の全面的な再設計は行っていません。

## 実機確認と制限

実ニコニコ動画からのPhase 3保存は未確認です。Phase 3の完了判定には、ユーザー環境でのAAC保存確認が必要です。

1. 拡張機能を再読み込みし、downloads権限の追加に伴って無効化された場合は再度有効化する。
2. 動画ページも再読み込みし、再生した状態でNicoPocketを開く。
3. 動画情報を確認し、タイトル編集後にDownloadを押す。
4. 対象動画のAACが従来どおり保存され、処理終了後に再度Downloadを押せることを確認。
5. 別動画で同じ操作を行い、動画と保存音声が一致することを確認。
6. 連打しても保存が重複しないこと、失敗や保存キャンセル後に操作可能になることを確認。

実サイトのシステムメッセージ表示、ログイン条件・CORS・配信形式、ブラウザの保存ダイアログ、保存の中断・キャンセルは実機確認対象です。極端に長い動画や、ページ側のDOMが変更された場合も確認が必要です。

## Phase 4の差し替え位置

`nico_downloader/dist/utils.js` の `DownEncoder()` 内、FFmpegのprintコールバックが `FFMPEG_END` を受け取る箇所です。

```text
core.FS.readFile(FSOutputFileName)
  → 既存AACバイト列
  → Blob生成
  → downloadlinkへURLと保存名を設定
```

AAC生成完了後のバイト列取得からBlob生成前が、M4Aへのremuxを挟む候補です。Phase 3ではこの実装位置と出力内容を変更していません。接続側は元のprint処理の実行後、生成済み保存リンクを既存関数でクリックしています。

Phase 4ではこの境界にM4A化を接続し、表示拡張子・MIME・保存名と保存状態の追跡を更新します。Artwork・クロップ・品質分岐は今回未接続です。

## 参照

- ユーザーのPhase 3実装指示
- `PHASE1.md`、`PHASE2.md`
- `nico_downloader/nicovideodownloader_scripts.js`
- `nico_downloader/func/ndl.js`、`nico_downloader/dist/utils.js`
- https://developer.chrome.com/docs/extensions/reference/api/downloads
- https://developer.chrome.com/docs/extensions/reference/api/storage
