# Phase 2: 現在の動画情報を編集画面へ接続

実装日: 2026-10-06

## 実装範囲

動画ページの既存ボタンを押したとき、既存の `NicovideoClass` で軽量な動画JSONを取得・再利用し、NicoPocket編集画面へ渡します。AAC・HLS・セグメント・FFmpeg・M4A・メタデータ埋め込みの実装は変更していません。DownloadとArtwork編集は引き続き無効です。

## 変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/manifest.json` | 共有タイトル関数と動画情報アダプターを登録。権限追加なし。 |
| `nico_downloader/pocket/title.js` | タイトル正規化の共通関数を追加。 |
| `nico_downloader/pocket/video-info.js` | 既存クラスで情報を取得し、UIに必要な項目を抽出。 |
| `nico_downloader/pocket/content.js` | 開く要求に現在の動画情報を添付。 |
| `nico_downloader/pocket/background.js` | 取得元を照合し、必要な項目だけをsession storageへ保持。既存のウィンドウ表示構成を利用。 |
| `nico_downloader/pocket/window.html` | 動画ID・投稿者・サムネイル・情報取得状況の表示を追加。 |
| `nico_downloader/pocket/window.css` | 動画情報の表示と、元サムネイルを縦横比を保って表示するスタイルを追加。 |
| `nico_downloader/pocket/window.js` | 情報の初期表示、同じ動画の編集保持、別動画への切替、画像読み込み状態を接続。 |
| `PHASE2.md` | 実装内容、仮定、確認結果、次Phaseの接続箇所を記録。 |

## 既存コードの再利用

- `NicovideoClass.SetAllFromVideoSm()` と既存の動画ID別キャッシュを再利用。
- JSON取得は既存 `DownloadJson()` の `watch/{id}?responseType=json` をそのまま利用。
- `JsonToTitle()`、`JsonToId()`、`JsonToUser()`、`GetWatchData()`、`GetVideo()` を再利用。
- 元の `func/nicojson.js`、`func/ndl.js`、`nicovideodownloader_scripts.js`、FFmpeg・Wasm・utilsはHEADとバイト一致。
- サムネイルは既存JSONのvideo.thumbnailから、投稿者は既存アクセサーを優先して取得。watchV4のowner・channelは不足時の補完として使用。
- 音質情報は既存JSONの `media.domand.audios` に値がある場合のみ抽出。配信プレイリストの取得は行わない。

## 接続したデータと内部状態

| 項目 | UI・内部状態 |
| --- | --- |
| タイトル | 正規化後に入力欄へ設定。編集可能。元タイトルも保持。 |
| 動画ID | URLのwatchパスから抽出し、JSONのIDと照合。UIへ表示。 |
| 投稿者 | UIへ表示し、内部状態にも保持。取得できない場合は明示。 |
| サムネイルURL | Artwork欄へ元画像を表示。クロップ・ズーム・位置調整は未接続。 |
| 音声品質 | id、available、bitrate（存在する場合）のみ保持。選択処理は未接続。 |
| 取得元 | 動画URL、動画ID、送信元タブIDを保持。 |
| 取得状況 | upstream-json / page-fallback と不足情報の有無を保持。 |

`chrome.storage.session` の `np:videoContext` に必要な項目だけを保持し、UIでは `NicoPocketEditor.context` を参照できます。編集後タイトルは `NicoPocketEditor.title`、選択音質は `NicoPocketEditor.quality` です。JSON全体や音声配信URLはUI用状態へコピーしません。

同じタブ・同じ動画での再表示ではタイトルと音質の編集を保持します。異なる動画、または別タブから開いた場合はその動画の情報へ切り替え、音質は標準音質へ戻します。ウィンドウを閉じた場合、編集中の値は破棄されます。

`NicoPocketTitle.normalize(value, fallback)` はUnicode NFC正規化、禁則文字と制御文字の置換、空白整理、末尾の空白・ピリオド除去、Windows予約名の回避、180コードポイント上限、空タイトルの動画IDフォールバックを行います。後続Phaseでファイル名とmetadata.titleに同じ関数を利用できます。入力中は値を強制変換せず、保存直前の再正規化はPhase 3以降で接続します。

## 仮定と失敗時の扱い

- JSON形式は既存クラスが扱う旧response形式とwatchV4形式を前提としています。
- サムネイルはHTTPS URLのみ使用。元画像はcontainで表示し、正方形の表示枠内で切り取らず縦横比を維持します。
- JSON取得に失敗した場合、ページのh1 / og:titleとog:imageを利用可能な範囲で補完します。投稿者は推測しません。不足情報を画面に表示します。
- 音声品質のビットレートがJSONに存在しない場合はnullとし、品質IDから推測しません。標準音質は192 kbps基準、高音質は取得可能な元音源を利用する仕様を表示するだけです。
- 情報取得中に動画IDが変わった場合は結果を破棄し、現在の動画から再度開くよう案内します。
- ページ内遷移ではChromeのsender.urlが最初の文書URLのままになるケースがあるため、sender.tab.urlを優先して照合します。

## 確認済み

実リポジトリを一時プロファイルのChromeへ直接読み込み、外部通信をローカル合成応答へ置き換えて以下を確認しました。

- 旧response形式・watchV4形式からタイトル、動画ID、投稿者、サムネイルを表示。
- タイトルの禁則文字・空白・末尾ピリオド・予約名・Unicode・空文字・長さの正規化。
- 元サムネイルの読み込みと縦横比保持。
- 標準音質の初期選択と音声品質情報の保持。
- 同じ動画の再表示時に既存キャッシュを利用し、編集タイトルを保持。
- 別動画への切替時に情報を更新し、音質を標準音質へ初期化。
- ページ内遷移中の古い取得結果を反映しないこと。
- JSON取得失敗時のページ情報による補完と不足情報表示。
- 375px幅での表示、Download無効状態、ウィンドウの重複作成防止。
- 音声セグメント・HLS・メディア取得リクエストを発生させないこと。

## 実機確認が必要な箇所

実サイトでのPhase 2表示は未確認です。拡張機能と動画ページを再読み込みし、現在の動画を開いてください。

1. 実タイトルが正規化されて入力欄へ入ること。
2. 動画IDと投稿者名が実際の動画に一致すること。
3. 実サムネイルが切り取られず表示されること。
4. 初回は標準音質が選択されていること。
5. タイトル編集後に同じ動画を再度開いて編集が維持されること。
6. 別動画へ移動した後に古い動画情報が残らないこと。
7. DownloadとArtwork編集が引き続き無効であること。

チャンネル投稿・限定公開・ログイン条件のある動画でJSON項目が異なる場合は、表示結果の確認が必要です。サムネイルのアクセス条件や実JSONに音声品質情報が含まれるかも実機確認対象です。

## Phase 3の接続箇所

- `window.js` の `#download` に操作を接続し、`NicoPocketEditor` から編集タイトル・音質・取得元を読み取る。
- 実行直前に `NicoPocketTitle.normalize()` で最終タイトルを確定し、将来のmetadata.titleと共通利用する。
- 取得元タブと動画IDが現在も一致することを確認したうえで、既存の `VideoDown()` / AAC取得経路へ明示的な要求を送る。既存関数は保存まで含むため、呼び出しと保存の境界を確認する。
- 標準音質／高音質と、保持した音声品質情報を接続する。今回の品質ID・bitrateは参考情報であり、選択実装を保証するものではない。
- 画像加工、M4A化、Metadata / Artwork埋め込みは別途後続Phaseで扱う。

## 参照

- ユーザーのPhase 2実装指示
- `README.md`、`PHASE1.md`
- `nico_downloader/func/nicojson.js`
- Chrome公式: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome公式: https://developer.chrome.com/docs/extensions/reference/api/storage
