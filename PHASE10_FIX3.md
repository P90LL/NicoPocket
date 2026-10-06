# Phase 10 FIX3 — 出力所有者・保存分離・入力遮断・モック準拠

## 範囲と確認の限界

NicoPocketの旧AAC出力経路、ページクリック、Artwork編集時の入力遮断、既存モックとのUI差を修正した。Metadataマッピング、音質仕様、M4A生成引数、AAC stream copy、JPEG Artworkの埋め込み仕様は維持する。コミット・プッシュは実行しない。

実サイトで報告されたAACの2件保存とプレーヤー設定の自動表示について、当該ユーザー環境の発火履歴は取得していない。以下の「原因」は実コードで確認できた残存経路と構造上の問題を指す。どの経路が実サイトの各AACを実際に保存したか、別の拡張機能・旧読み込み済みスクリプトが関与したかは未確定。合成検証を実サイトでの解消確認とは扱わない。

## 1. 保存全経路の追跡と修正

実コードのAAC、出力形式、FFmpeg完了、Blob、リンク生成、クリック、初期化・イベント登録を検索した。同梱FFmpegランタイムのファイル読み込みと、ブラウザへのユーザーファイル保存を区別した。

| 修正前の箇所 | 動作・問題 | 修正後 |
| --- | --- | --- |
| `nicovideodownloader_scripts.js` の `VideoDown` | 起動時に `DownloadLinkClick` を呼ぶ。UIの識別子が見えない実行環境では所有者チェックを通過し得る | 明示的なNicoPocketジョブを必須にし、取得開始をジョブにつき一度へ限定。旧保存呼び出しを除去 |
| `VideoDown` の初期UI生成 | `ButtonFirstMake` / `SaveButtonMake` で旧保存UIを作る入口 | NicoPocket入口から旧UI・保存ボタン生成を除去 |
| `dist/utils.js` の `runFFmpeg_m3u8` | グローバル保存設定に依存するAAC/MP4の旧出力分岐が残存 | ジョブ所有者を確認しM4Aのみを生成。旧AAC/MP4出力分岐を除去 |
| `DownEncoder` の `FFMPEG_END` | 出力形式依存のBlob生成後、旧 `a#downloadlink` と `document.body.click()` に進む分岐が残存 | 所有者を確認し `audio/mp4` Blobのみ生成。一度だけ `job.onOutput` へ渡す。旧リンク・ページクリックを除去 |
| `func/ndl.js` の `DownloadLinkClick` | 旧リンクをクリックする上流の実装 | 上流クラスは保持するが製品のブリッジでは無条件に無効。取得開始からの呼び出しも除去 |
| 同クラスの `SystemMessageAutoOpenToText` / `SaveButtonInnerHTMLMake` | 設定・システムメッセージをクリックする旧onclick文字列 | 上流の内部実装は保持。NicoPocketジョブでは旧保存UIを作成せず、ジョブ付きUIメソッドも無効 |
| `pocket/aac-bridge.js` の `save` | 動画ページの実行環境から最終M4Aリンクをクリック | 最終M4Aをチャンクで拡張ウィンドウへ転送。動画ページで保存リンクも保存Blob URLも作らない |
| `pocket/content.js` のイベント・MutationObserver | 旧入口を置換し残存リンクを除去 | 防御を維持し、取得・出力そのものの所有者判定も追加したため、リンク抑止だけに依存しない |
| 新設 `pocket/save.js` | 存在しなかった | 拡張ウィンドウ内の最終M4A専用保存。唯一のユーザー向け保存要求 |

`func/ndl.js` の `ButtonFirstMake` が作るアンカーは状態表示用で、単独ではBlob・download属性を持たない。旧保存用onclick文字列はNicoPocketから生成されない。用語辞典用コードのクリック例はコメントであり、保存経路ではない。

### 多重要求への対策

- DOMの有無ではなく `outputOwner: nicopocket` と現在のジョブ・動画IDを取得開始から使用。
- `acquisitionStarted` / `encoderStarted` / `outputProduced` / `saving` で各段階の再入を防ぐ。
- `MovieDownload_domand` は自身のdownloaderに結び付いたジョブを使い、現在の別ジョブを借用しない。動画IDも照合。
- ブリッジ再読み込み時のイベント多重登録を防ぐ。
- backgroundの保存準備は同期のSetと保存済み状態で重複排除。
- 拡張ウィンドウの転送はジョブID、取得元タブ、サイズ、チャンク順序、MIME、保存名を検査。
- FFmpeg完了通知を二重に届ける合成試験でも保存要求は1件。
- `last_save_sm` による動画単位の重複管理を除去。再保存は新しいジョブとして処理。

## 2. 最終保存フロー

```text
NicoPocket Download
→ 明示的な所有ジョブ
→ 既存VideoDown / MovieDownload_domand / HLSエンジン
→ 既存FFmpeg（AAC copy + Metadata + JPEG attached_pic）
→ audio/mp4 Blob（M4Aのみ）
→ 順序付き64 KiBチャンク転送
→ NicoPocket拡張ウィンドウ内のaudio/mp4 Blob
→ backgroundで保存所有者・ジョブ・保存名を登録（saveRequestCount = 1）
→ 拡張ウィンドウ内のDOMに接続しない最終M4Aリンクを1回実行
→ chrome.downloadsで開始・完了・中断を監視
→ Blob URL、転送データ、一時Artwork/M4Aの後始末
```

保存リンクは動画ページに存在せず、拡張ウィンドウ内でも背面UIへ接続しない。クリックの伝播を停止し、ユーザー向けには編集タイトルのM4Aだけを要求する。保存診断用にはセッション状態へ `owner` / `savedFilename` / `savedMime` / `saveRequestCount` を保持する。ファイル内容・署名付き配信URLを診断ログへ出力しない。

### Downloads APIを直接の保存開始にしなかった理由

専用プロファイルの通常Chromeで、`chrome.downloads.download` の直接保存はArtwork付き生成物を動画MP4として判定し、指定したM4A拡張子をMP4へ置き換えることを確認した。保存名確定イベントやコンテナ識別情報の変更も試したが、安定して解消しなかった。これらの実験コード・コンテナ変更は最終実装に採用しない。

そのため「動画ページをクリックしない」「M4A名を維持する」の両条件を満たす、拡張ウィンドウ内の唯一の保存入口を採用する。Downloads APIは所有ファイルの監視・キャンセルに利用する。新規権限やOffscreen構成は導入しない。

## 3. プレーヤー設定への干渉

確認できたページクリックは、旧FFmpeg完了時の `document.body.click()`、旧保存ボタンが持つ設定・システムメッセージ用onclick、ブリッジ準備時の設定ボタン・システムメッセージのクリックだった。実サイトで完了直後にどれが発火したかは未捕捉だが、NicoPocketの実行経路からすべて除去した。

取得元情報は既存 `MasterURLGet` で受動的に確認する。必要な情報がページ内に存在しない場合は15秒の待機後に操作可能なエラーへ戻り、動画再生・システムメッセージ表示をユーザーへ案内する。NicoPocketが設定メニューを開くことはない。

起動ボタンのclick、Enter/Space、pointerイベントを範囲限定で止める。保存処理の終了時にも動画ページの要素をクリックしない。上流取得クラスを全面改名・全面書き換えはしていないが、本製品の取得入口は明示的なNicoPocketジョブ専用とした。

## 4. Artwork Modal入力遮断

- ネイティブdialog / backdropと背面 `.app-shell` のinert・aria-hidden。
- 背面のプログラムからのイベントも範囲限定のcaptureで遮断し、Download入口でもdialog.openをチェック。
- Modal内へ初期フォーカスを移し、Tab / Shift+Tabを閉じ込める。
- Escapeでキャンセル。閉じる際に元の編集ボタン等へ安全にフォーカス復帰。
- メイン画面のスクロールを停止。Modal内イベントを伝播させず、編集領域のwheelはpreventDefaultでZoomのみ処理。
- sourceTabId / videoId / sourceUrlを照合して取得元タブへ入力遮断を通知。
- 動画タブの背面要素もinert化し、全面の入力遮断領域とcaptureでclick、pointer、wheel、keyboard等を止める。
- Modalを閉じる、拡張ウィンドウを閉じる／再読み込みする（接続解除）、動画がSPA切り替えになる場合に解除。既にinertだった要素は元の状態へ復帰。
- Chrome自身のツールバー・ウィンドウ切替・許可ダイアログ等は操作・自動承認しない。

## 5. 既存モックとの比較とデザイン反映

ユーザー指定の既存 `nico-pocket-mock` のindex.html / style.css / script.jsとロゴ・サムネイル資産を確認した。参照元のローカル絶対パスはこの記録・実装へ書き込まない。

反映した内容:

- Interを含むフォントスタック、62pxタイトルバー、ブランド間隔。
- 1120pxを基準とするコンテンツ、主領域1.55fr / Artwork0.8fr、18pxのgap。
- 16pxカード角丸、主領域26px / Artwork24pxのpadding、既存モックの暗色トークン。
- Artwork editorの大きな左編集領域と右側の設定・preview。基準1.45fr / 0.55fr、18px gap。
- 元画像の周辺を残し、固定1:1枠、周辺の暗転、三分割線で出力範囲を明示。
- 右側にZoom、Reset、180px preview、位置情報、出力形式を表示。
- Cancel / Applyを下部へ配置し、900px / 640px基準で狭い画面を調整。

機能上維持した配置: 元タイトルと保存タイトル、音質、Metadata、Artwork、Artwork下のDownloadと進捗・状態。既に削除した導入見出しや不要なファイル選択は復活しない。

意図的な差異: モックのサイドバー、保存キュー、設定ページ、仮ダウンロード成功ダイアログ、旧AAC/JPEGの中間保存選択は導入しない。editorは本製品のModal方式を維持し、モックの編集面とツール構成を適用する。ダーク固定を維持する。

復活させない機能: 中央へ戻す、最大サイズ、自動解析、MediaPipe、自動クロップのボタン、元画像へ戻す。操作はDrag / Zoom / Reset / Cancel / Applyのみ。未編集の中央クロップ生成と768×768 JPEG / quality 0.9は維持する。

## 6. 検証結果

### 合成ページ・合成配信 + 実際のChrome拡張機能・同梱FFmpeg

- 所有者なしVideoDown / DownEncoder / FFmpeg入口の拒否。
- FFmpeg終了通知を2回発生させても、各ジョブ1件のM4Aだけを要求。
- 128のみ、128/192、128/192/256、256のみ、品質不明の5ケース × 標準/高音質: 10件のM4A。保存要求カウントはいずれも1。
- 出力AACのバイト一致、Metadata/titleと保存名一致、JPEG attached_pic、768×768、デコード、シーク、仮想FSの後始末。
- 初回、同一動画2回目、別動画へのSPA切り替え: M4Aのみ。別動画のVideo IDも一致。
- 保存開始保留のタイムアウトと再試行、Chromeで保存を拒否したinterruptedと再試行。
- HLS/FFmpeg失敗からの復帰、取得キャンセルからの再試行、画像取得失敗時の音声+Metadataのみ保存。
- 動画ページへの完了clickなし。旧downloadlinkなし。
- ModalのDrag / Zoom / Cancel / Reset / Apply、背面のプログラムclick遮断、Tab/Shift+Tab、Escape、フォーカス復帰、wheelと狭い画面。動画タブの背面要素のinert、プログラムclick、Tab、wheelの遮断と閉じた後の復帰も確認。
- 構文チェック・差分チェック。

### 実サイト

未検証。ユーザー環境で拡張機能と既存動画タブを再読み込みして、次を確認する:

1. 初回・同一動画2回目・別動画の各Downloadで、M4Aが1件だけ保存されAACが0件である。
2. 完了時にプレーヤー設定が勝手に開かない。
3. Artwork Modal中、NicoPocket背面と取得元動画タブが操作できず、閉じると復帰する。
4. 元画像・preview・長いタイトル/URL・狭い画面の見た目。
5. 保存先ダイアログ、Chromeの実際の許可要求、対応プレーヤーでのArtwork表示。

## 7. 未解決事項・制限

- 過去に発生した2件のAACそれぞれの実サイトcall siteは未捕捉。現コードの旧AAC生成・ページ保存経路は除去した。
- 別拡張機能や既にChromeへ渡された所有者不明の古い保存要求を本拡張機能が一律キャンセルすることはしない。既存保留はChromeのダウンロード一覧で確認・中止する。
- 更新前のページに読み込み済みの旧スクリプトは、ファイル更新だけでは置き換わらない。拡張機能と取得元ページの再読み込みが必要。
- 配信元ログが表示されていないページはユーザーによる再生・システムメッセージ表示が必要。
- Chromeの本物の許可ダイアログ・保存先選択の操作、および実プレーヤー表示はユーザー実機で確認する。
- ブラウザ自身の操作や別拡張機能のイベントはNicoPocketのModal制御対象外。

## 8. センシティブ情報

変更した実装・記録全体について、ローカル絶対パス、ユーザー名、固定拡張機能ID、資格情報、セッション、署名付き配信URL、実機配信データの混入を検査する。テスト用のスクリプト、ログ、専用Chromeプロファイル、合成メディア、スクリーンショットはリポジトリへ追加しない。診断用一時コードは除去済み。全11ファイルの機械検索と該当箇所の目視確認を完了し、センシティブ情報の混入なし。ソースコード参照として従来から存在するGitHub URLは実HLS URLではない。

## 9. コミット案

コミット・プッシュは実行しない。分割する場合はwindow.htmlとbackground.jsの変更箇所を分けてステージする。

### 1. fix: NicoPocketの旧AAC出力を除去しM4A保存を分離

対象: dist/utils.js、nicovideodownloader_scripts.js、pocket/aac-bridge.js、pocket/save.js、background.jsの保存管理部分、window.htmlのsave.js読み込み。

- 取得開始・FFmpeg開始・終了・出力を明示的なジョブ所有者で限定
- 旧AAC出力分岐・保存リンク生成・動画ページクリックを除去
- 最終M4Aだけを拡張ウィンドウへ転送し、唯一の保存要求を登録
- Metadata・Artwork・音質仕様・AAC stream copyを維持
- 重複通知、10音質ケース、連続保存、中断・キャンセル・HLS/FFmpeg失敗後の再試行を合成検証
- 実サイトの初回AAC追加保存とChromeの実許可ダイアログは実機確認へ

### 2. fix: Artwork編集の入力を遮断しモック準拠UIへ調整

対象: pocket/content.js、artwork.js、window.js、window.css、window.htmlのeditor構造、background.jsのModal同期、PHASE10_FIX3.md。

- NicoPocketと取得元タブの背面入力をModal中だけ遮断
- focus trap、Escape、フォーカス復帰、スクロールとwheel伝播停止
- 既存モックの編集領域、三分割枠、設定欄、preview、spacing、responsive構成を反映
- 削除済み機能を復活させず、JPEG/Metadata/音質を維持
- 合成ページでDrag/Zoom/Apply/Cancel/Reset、背面入力・Tab・wheel・復帰、狭い画面を検証
- 実サイトと見た目の最終確認事項を記録

GitHub Desktopで変更箇所の分割が難しい場合の一括件名:

`fix: AAC多重保存とプレーヤー干渉を修正しNicoPocket UIを調整`
