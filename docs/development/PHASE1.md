# Phase 1: NicoPocket編集ウィンドウ

実装日: 2026-10-06

作業先: NicoPocketリポジトリ

## 実装内容

動画ページの「aacを保存」が既にある場合、そのボタン・リンク要素自体を同じ位置で「NicoPocketで保存」へ変更し、押すと編集ウィンドウを開きます。元のボタンと別の入口を並べません。旧保存リンクのhref・download・onclickを除去し、document_startで登録したクリック捕捉処理により残っている旧ハンドラーと標準ダウンロード動作を抑止します。ボタンの遅延表示にもDOM監視で対応します。既存要素がまだない場合は元のボタン位置に入口を1つ配置し、実際のAACボタンが現れたらその要素へ切り替えます。開いている場合は同じウィンドウを前面に表示し、編集内容を保持します。「閉じる」またはブラウザのウィンドウ操作で閉じられ、閉じた後も再表示できます。閉じると入力内容は破棄されます。

タイトルは空欄から編集できます。Artworkは1:1の表示枠と未設定表示のみです。音質は「標準音質」を初期値とし、「高音質」へ切り替えられます。DownloadとArtwork編集ボタンは準備中として無効です。

`NicoPocket-Archive/src/pocket/window.css` の必要な画面・配色・入力部品のスタイルと `logo.svg` を再利用しています。音質選択は現在のREADMEと今回の依頼に合わせました。アーカイブの取得・変換・画像加工・キュー実装は取り込んでいません。

## 変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/manifest.json` | UI用content script/CSS、ウィンドウ表示用service workerを登録。権限は既存のstorageのみ。 |
| `nico_downloader/nicovideodownloader_scripts.js` | 既存タイマーの呼び出し先とコメントの2行のみ変更。VideoDownとMovieDownload_domandの本体を保持。 |
| `nico_downloader/pocket/content.js` | 既存ボタン位置・IDを利用し、ウィンドウ表示を要求。「aacを保存」の既存要素自体を同じ位置で編集ボタンへ変更。document_startから旧クリック動作を抑止。動画以外のページではボタンを除去。 |
| `nico_downloader/pocket/content.css` | 動画ページ上のボタン表示。 |
| `nico_downloader/pocket/background.js` | ウィンドウを作成・再表示。送信元を検証し、同時操作による重複作成を防止。 |
| `nico_downloader/pocket/window.html` | タイトル、Artwork、音質、Download、閉じるを配置。 |
| `nico_downloader/pocket/window.css` | アーカイブから必要なスタイルを再利用。狭い画面に対応。 |
| `nico_downloader/pocket/window.js` | 閉じる操作。 |
| `nico_downloader/pocket/logo.svg` | アーカイブのロゴを複製。 |
| `PHASE1.md` | 実装内容・検証・次Phaseの接続箇所。 |

## 確認結果

- 指定リポジトリの `nico_downloader/` を一時プロファイルのChromeへ直接読み込み、拡張機能のロード、実際の編集ウィンドウ表示、再表示時の入力保持、閉じる、閉じた後の再表示を確認。
- Chromeの合成DOMで、既存タイマーからUIボタンが配置されること、クリック時に表示要求だけが送られること、重複ボタンができないこと、動画ページ以外への移動と動画ページへの復帰を確認。取得呼び出しは検出用のエラーに置き換えて確認。
- タイトル編集、標準音質の初期値、高音質への変更、Downloadの無効状態、ロゴ表示、375px幅で横にはみ出さないことを確認。
- service workerの送信元検証、同時表示要求、閉じた後の再作成をAPI模擬テストで確認。
- 旧「aacを保存」リンクが元のDlink領域以外にある合成ページで、同じ要素・位置を保持し別入口が追加されないこと、旧要素とdocumentのクリックハンドラーが実行されないこと、DOM監視の実行前に押した新規AACボタンも捕捉されることを確認。実際のcontent scriptによる動作変更 → メッセージ送信 → service worker → 編集ウィンドウ表示を確認。表示要求を再実行してもウィンドウが増えないことを確認。動画サイトへのリクエストはローカルの合成HTMLで応答し、実サイトの通信は行っていません。
- `func/ndl.js`、`func/nicojson.js`、FFmpeg・Wasm・utilsはHEADとバイト一致。取得関数の本体も変更なし。
- ユーザーが実ニコニコ動画ページから編集ウィンドウを開けること、編集画面から保存処理へ進めない状態が維持されていることを確認。サイト遷移時の動作とAAC保存は未検証。

## 手動確認

1. Chrome拡張機能管理画面で、リポジトリ内の `nico_downloader/` を読み込み、既に登録済みの場合は再読み込みします。
2. 動画ページを再読み込みし、数秒後に「NicoPocketで保存」が表示されることを確認します。
3. ボタンから編集ウィンドウを開き、タイトルと音質を編集します。
4. 動画ページのボタンを再度押し、同じ編集ウィンドウと入力内容が保持されることを確認します。
5. 編集ウィンドウを閉じ、動画ページのボタンから再表示できることを確認します。

## 次Phaseで接続する箇所

1. `pocket/content.js` の表示要求に、動画ID・取得元タブとの関連を追加します。`background.js` から `window.js` へ軽量な動画情報を渡し、タイトルとサムネイルを初期表示します。別動画への移動時には取得元の整合性を確認します。
2. `window.js` の `#download` に、編集タイトルと `#audio-quality` の値を受け取る処理を接続します。既存 `VideoDown()` は取得から自動保存までを含むため、そのまま呼ぶ前に保存境界を確認します。動画ページの既存処理へ渡す導線は次Phaseで設計します。
3. Artworkの読み込み・1:1トリミングを接続します。画像処理はPhase 1の表示枠とは別途実装が必要です。
4. 音質値 `standard` / `high` を取得可能なストリームへ対応付けます。今回の選択操作は取得品質へ影響しません。
5. M4A変換・メタデータ・Artwork埋め込みは後続Phaseの対象です。

## 参照

- 現在の `README.md`
- ユーザーのPhase 1指示と作業先指定
- `NicoPocket-Archive/src/pocket/window.html`
- `NicoPocket-Archive/src/pocket/window.css`
- `NicoPocket-Archive/src/pocket/logo.svg`
- Chrome公式: https://developer.chrome.com/docs/extensions/reference/api/windows
- Chrome公式: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
