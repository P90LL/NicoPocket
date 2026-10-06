# Phase 6: Artwork画像編集とJPEG生成

## 変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/pocket/artwork.js` | Canvasによる固定1:1クロップ、画像取得、ドラッグ・矢印キー・ズーム、リセット、JPEG生成、状態保持を追加。 |
| `nico_downloader/pocket/window.html` | Artwork編集と元画像への復帰を有効化。既存デザインに合わせた編集dialogを追加。 |
| `nico_downloader/pocket/window.css` | 編集dialog、固定正方形プレビュー、ズーム操作のスタイルを追加。 |
| `nico_downloader/pocket/window.js` | NicoPocketEditor.artworkとArtwork表示を接続。既存Download・Metadata要求の内容は維持。 |
| `nico_downloader/manifest.json` | サムネイル取得用にnicovideo.cdn.nimg.jpとtn.smilevideo.jpのHTTPSホスト権限を追加。 |
| `PHASE6.md` | 仕様・検証結果・保留事項・次Phase接続を記録。 |

## データフロー

```text
Phase 2のcontext.thumbnailUrl
 → 編集ウィンドウでfetch（credentials: omit、no-referrer）
 → Blob → ImageBitmap
 → 1:1固定のCanvasプレビュー
 → Zoom・X/Y調整
 → 適用時にCanvas.toBlob（JPEG）
 → NicoPocketEditor.artwork.blob
 → Artwork欄の正方形プレビュー
```

画像ライブラリ、MediaPipe、新たな画像入力やFFmpeg実行は追加していません。サムネイルを拡張機能画面で取得してからCanvasへ描くことで、外部画像のCanvas出力制限を避けます。設定した2ホスト以外の画像は配信元のCORS許可が必要です。失敗時は表示して再試行可能にし、Downloadを止めません。

## クロップ方式

比率は常に1:1です。固定の正方形枠の内部画像を移動・拡大します。

- 初期値: Zoom=1、X=0、Y=0。短辺を正方形へ合わせ、中央を切り出すcover相当。
- Zoom: 1〜4倍、スライダーで変更。100〜400%を表示。
- X/Y: 元画像の中心からのずれを元画像ピクセル単位で保持。
- 切り出す一辺: min(画像幅, 画像高さ) / Zoom。
- X/Yを画像内の範囲へ制限し、ドラッグやズーム変更後も余白を出さない。
- ドラッグ、矢印キーによる位置調整とリアルタイムプレビュー。
- リセットは編集dialogの作業中データを初期値へ戻す。適用するまで確定しない。
- キャンセル・Escapeは作業中の変更を破棄し、前回の適用結果を維持。
- 元画像へ戻すは確定済み編集・JPEGを解除し、初期値と元サムネイル表示へ戻す。

## 出力と状態保持

JPEG、image/jpeg、768×768、品質0.9です。透過部分は白背景へ描きます。低解像度の元画像が高精細化されるわけではありません。画像のダウンロードは行いません。

NicoPocketEditor.artworkに以下を保持します。

- 動画ID、取得元タブID、取得元URL、元サムネイルURL
- Zoom、X、Y
- edited（編集適用済みか）
- blob（生成済みJPEG）、mime、width、height

同じ編集ウィンドウ内でArtwork編集dialogを閉じて再度開くと状態を維持します。保存状態の更新だけではArtworkをリセットしません。編集ウィンドウ自体を閉じる・再読み込みする場合の永続保存は未実装です。Blobはstorageへ直列化せずメモリ上で保持しています。

## 動画・画像の整合性

取得元タブID、動画ID、取得元URL、サムネイルURLを組にして照合します。いずれかが変わると編集dialogを閉じ、Zoom/X/Y・JPEG・編集済みフラグを初期化します。

画像取得はAbortControllerで中止し、世代番号と状態参照を照合します。遅れて到着した別動画の画像や、切り替え前に生成中だったJPEGを採用しません。ImageBitmapとプレビュー用Blob URLは切り替え・閉じる際に解放します。

画像取得は20秒上限、入力Blobは10MB、画像は4,000万ピクセルまでです。画像取得失敗は再試行可能で、サムネイル欠損時は編集ボタンを無効化します。

## 合成データ・実装本体による確認

一時Chromeへリポジトリの拡張機能を直接読み込み、画像・動画JSON・配信応答のみ合成データに置き換えて確認しました。

- 横長・縦長サムネイルが中央coverの固定正方形になる。
- ドラッグとズームで位置が変わり、端へ大きく移動しても範囲内に制限される。
- JPEGをデコードし、768×768・image/jpeg・期待した切り出し位置の画素を確認。
- 編集を適用後、再度開くとZoomと位置を維持。
- リセット、キャンセル、適用、元画像へ戻すの動作を確認。
- 保存完了等のUI更新後も編集状態が維持される。
- 動画・サムネイル変更時に初期化し、遅れて到着した旧画像が混入しない。
- 画像取得失敗後の再試行と、サムネイル欠損時の表示を確認。
- 通常サイズ・幅400pxの画面を画像で確認。
- 編集済みArtworkがあっても既存Metadata付きM4Aを保存できる。
- ffprobeで音声1ストリームのみ、Artworkなし、既存タグ保持を確認。
- TS・CMAF音声のバイト一致、全体デコード・シーク、二重実行防止・動画照合・エラー復帰と再試行を確認。
- 成功したM4A保存のほかにJPEG等のダウンロードがないことを確認。

失敗を意図的に起こしたテストでは既存エラーログが発生します。合成データの結果は実サイト確認とは区別します。

## 既存機能への影響

HLS・AAC取得、M4A生成、Metadata・FFmpeg引数、background側の保存監視は変更していません。Download要求にArtworkを渡していません。画像読み込みが失敗しても既存Downloadは操作できます。ページ側の進捗表示は維持しています。

## 実サイトで必要な確認

1. 拡張機能と動画ページを再読み込みする。権限追加で拡張機能が無効になった場合は再度有効化する。
2. 実サムネイルの読み込み、編集dialog、ドラッグ、ズーム、リセットを確認。
3. 適用後の正方形プレビュー、再度開いた時の状態保持、元画像への復帰を確認。
4. 別動画で状態とサムネイルが初期化されることを確認。
5. 既存M4A保存・Metadata・再生が維持され、Artworkや中間JPEGが保存されないことを確認。

実サイトのサムネイル配信ホスト・権限・画像形式、長い動画、プレイヤーでの確認は未実施です。

## センシティブ情報チェック

変更6ファイル（新規ファイルを含む）を対象に、ローカル絶対パス・ユーザー名・APIキー・Token・Cookie・Authorization・個人識別情報・環境固有情報・一時URL・実セッション値・署名付きURL・資格情報を検査しました。センシティブ情報の混入なし。実行時の変数名や画像取得のcredentials: omitは資格情報の固定値ではありません。合成検証用のURL・ログ・生成画像はリポジトリへ追加しません。

## 保留事項

- NicoPocket UI上に埋め込み予定Metadata一覧を表示する。
- 元の動画タイトルをArtwork欄付近に表示する。
- DL進捗表示をnico_downloader側からNicoPocket UIへ移す。
- Chrome側のDownload許可待ち・中断時の再試行対応。
- 同一動画をページリロードなしで再DLできるよう改善する。
- 標準音質 / 高音質の実処理接続。

上記は今回実装していません。

## Phase 7の接続候補

NicoPocketEditor.artwork.blobがJPEGデータの入口です。動画・タブ・画像URLの整合性を再確認し、Blob.arrayBufferからバイト列を作って取得側へ渡すことが候補です。Chrome runtimeメッセージにBlobをそのまま渡す方式は使用せず、シリアライズや受け渡し方法をPhase 7で決めます。

既存DownEncoderのcore作成後に仮想FSへ画像を書き込み、runFFmpeg_m3u8のM4A引数へ画像入力とmap・attached_pic等を追加する位置が埋め込みの候補です。音声copyとMetadata、画像の後片付けを維持します。

未編集時に中央coverのJPEGを生成して使うか、Artworkなしで保存するかもPhase 7で決めます。今回は画像入力・attached_pic・M4A埋め込みは追加していません。

## 参照

- ユーザーのPhase 6実装指示
- Phase 2〜5のcontext・NicoPocketEditor・保存処理
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
