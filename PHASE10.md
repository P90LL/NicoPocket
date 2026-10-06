# Phase 10 — 個人利用版の最終整理

## 方針・完了範囲

Phase 1〜9の取得・M4A・Metadata・Artwork・音質選択を維持し、名称・設定・保存待ち・文書を整理した。Chrome Web Store公開、配布フロー、大規模な取得処理変更は対象外。コミット・プッシュは実行していない。

## 保留事項の再確認

| 項目 | 対応・結果 |
| --- | --- |
| Chrome許可・保存先待ち | 保存開始前60秒の監視を維持。ID取得後は完了・中断イベントと編集画面からの5秒間隔照会を併用 |
| paused Download | 即時失敗扱いを撤廃し、保存待ち表示とユーザーによるキャンセルを維持 |
| 保存待ちの永久化 | 保存量に10分変化がなければ所有Downloadを中断して再試行可能にする。既存の全体30分上限も維持 |
| 旧AAC再開 | Phase 9の旧入口抑止、旧リンク無効化、所有URLとジョブ照合を維持。合成経路ではM4Aのみ保存 |
| 所有者不明の旧要求 | 無関係なDownloadを取消さない。更新前の要求はChromeで手動キャンセルする制限として記録 |
| 同一動画連続保存 | ページ再読み込みなしの連続保存・キャンセル後再試行を回帰確認 |
| Metadata / 元タイトル | 共通Metadata生成元・参照専用元タイトル・長い値の折り返しを維持。AlbumをSeries / Albumへ明確化 |
| PNG | 技術的な格納はPhase 9で確認済み。ネイティブプレイヤー比較未確認のためJPEGを維持 |
| 名称・アイコン・旧設定 | NicoPocketへ統一。旧形式・保存名の選択UIを使い方案内へ置換 |
| 権限 | 大百科content scriptとoptions画面の外部公開を削除。必要な画像2ホストと既存処理用資産を維持 |
| README / LICENSE / ログ | 現状へ更新。MIT原文維持。不要な無条件ログを削除しエラー診断を残す |

## 変更ファイル

- `nico_downloader/manifest.json`: 名前・説明・表示バージョン・アイコン・ツールバー案内、不要な大百科適用とoptionsのweb accessible公開を整理。
- `nico_downloader/options.html`: 旧設定画面を使い方・音質仕様・保存待ち案内・Creditsへ置換。期限切れOrigin Trialと固定拡張機能IDを除去。
- `nico_downloader/pocket/about.js` / `about.css`: manifest由来のバージョン表示と既存デザインに合わせた案内画面。
- `nico_downloader/pocket/icons/icon-16.png` / `icon-32.png` / `icon-48.png` / `icon-128.png`: 既存logo.svgを各サイズへ描画。旧資産は内部互換性のため保持。
- `nico_downloader/pocket/window.html`: 開発中表示を個人利用版へ変更。
- `nico_downloader/pocket/window.js`: 保存待ち表示、所有保存の照会、Metadataラベル調整。
- `nico_downloader/pocket/background.js`: 所有Downloadの状態・保存量監視、paused時の待機維持、無進捗タイムアウト。
- `nico_downloader/pocket/aac-bridge.js`: 新規・旧初期設定の取得既定値補完、保存開始タイムアウト文言。
- `nico_downloader/dist/utils.js`: 不要な引数・ファイル・内部オブジェクトのログを除去。取得URL・Blob URLを不要に出さないエラー文へ変更。
- `nico_downloader/options.js`: 不要な無条件ログを除去。既存内部設定関数と任意のDebugPrintは保持。
- `README.md`: 実装済み機能、使い方、音質ルール、権限、制限、ライセンスを現状へ更新。
- `LICENSE`: 元のMIT本文をリポジトリ直下へ複製。元の`nico_downloader/LICENSE`は変更しない。
- `PHASE10.md`: 最終整理・検証・制限・コミット案。

## 保存待ちと旧AAC経路

編集画面 → `np:aac-check-save` → background → 自分のDownload IDのみ検索 → 共有ジョブ状態 → UI更新。

照会要求は同じ拡張機能の編集画面からだけ受け付け、ジョブIDと保存フェーズを確認する。全Downloadを走査しない。paused、保存名未確定、保存量ゼロの場合を保存待ちの目安とし、保存量が増えた場合は保存中とする。Chrome APIは保存先ダイアログそのものを直接通知しないため、これは状態に基づく表示であり、ダイアログの確定識別ではない。

ID取得後は保存開始用タイマーを解除する既存仕様を維持。中断・完了イベントを優先し、照会で状態変化も拾う。10分無進捗タイムアウトは編集画面が開いている間の照会で判定する。キャンセル・エラー時は自分のIDのみ取消し、既存の処理中解除・Blob解放・再試行を利用する。拡張機能によるChrome許可UIの自動承認は行わない。

NicoPocketでは共通の旧`DownloadLinkClick`を抑止し、検証済み最終M4Aリンクのみを保存するPhase 9実装を維持。旧AAC保存機能の内部ロジックは全面削除しない。更新前にChrome自身へ渡された所有者不明のAAC要求は、安全に所有者を特定できず自動取消しできない。Chromeのダウンロード画面で手動キャンセル後、拡張機能と動画ページを再読み込みする。

## manifest・ブランディング

表示名・短縮名はNicoPocket。表示バージョンは`1.0.0（個人利用版）`、内部versionは旧`5.0.0.21`より進めた`5.0.0.22`。数値バージョンを下げず、表示と内部更新順を分けた。

既存ロゴから16 / 32 / 48 / 128 PNGアイコンを生成。新しいデザインは追加していない。旧MP4/AAC形式・保存名の設定UIを廃止し、オプションとツールバーは使い方ページへ統一。取得に必要な旧設定は内部に残し、NicoPocket経由の初期値を補う。

## permissions監査

| 対象 | 用途・判断 |
| --- | --- |
| storage | localの設定とsessionの動画情報・ジョブ・保存所有情報。必要 |
| downloads | onCreated/onChanged/search/cancelによる自分の保存監視。必要 |
| nicovideo.cdn.nimg.jp | Artwork元画像の取得。必要 |
| tn.smilevideo.jp | 既存動画サムネイル互換性。必要 |
| www.nicovideo.jpのcontent script | 動画情報・ボタン・既存取得処理。SPAで非動画ページから動画へ遷移するためドメイン配下の適用を維持し、動画ページ判定で実行を制限 |
| www.nicovideo.jp向けweb accessible assets | 既存FFmpeg WASMと補助スクリプトの読み込み。構造を維持 |
| dic.nicovideo.jp | NicoPocket対象外の大百科用content scriptを削除 |
| options.htmlのweb accessible公開 | 内部案内画面なので削除 |
| tabs / scripting / 全URL権限 | 要求していない。タブ操作には既存APIの利用範囲を維持 |

画像2ホストをこれ以上狭めるための実サイト全種調査は未実施。正常な既存サムネイル取得を優先して維持した。

## Artwork最終判断

標準は768×768 JPEG、Canvas品質0.9を維持。JPEGを画像stream copyでattached pictureとして使用する。PNGはPhase 9で同梱FFmpegの格納、画像バイト一致、Metadata、AAC維持を確認済みだが、QuickTime Player / Music / Finderでの比較は今回未確認。QuickTimeのコンピューター操作が許可されていないため、別手段で操作を迂回していない。ユーザーの実機確認へ引き継ぐ。プレイヤー互換性の確認を優先し、PNGへの既定変更は行わない。

## README・LICENSE・Credits

実装済みチェックリスト、正しい音質選択表、Artworkの適用手順、ローカル導入、更新時の再読み込み、制限・回避方法へ更新。ストア公開予定なしを明記。過去Phase文書は履歴として保持。

MIT本文と`Copyright (c) 2021 masteralice3104`を保持。基礎プロジェクト・FFmpeg・既存FFmpeg連携のCreditsを残す。同梱第三者資産のライセンスは別に適用される。

同梱WASMの構成文字列には`--enable-gpl`・`--enable-nonfree`・`--enable-libfdk-aac`が含まれる。元プロジェクトのMITが第三者バイナリ全体へ適用されるとは扱わない。今回は個人利用の既存FFmpeg基盤を維持し、再配布・ライセンス変更・新しいバイナリ導入は行っていない。

## 最終検証結果

合成配信と実際のChrome拡張機能・同梱FFmpegを使用した検証。実サイトの成功とは区別する。

- 新規storage初期状態で起動、案内ページ、名称・バージョン・4サイズのPNGアイコンを確認。
- 音質5ケース（128のみ / 128・192 / 128・192・256 / 256のみ / 不明）×標準・高の10保存。選択結果と別動画で標準へ戻ることを確認。
- 各出力をffprobeで確認。入力AACと出力AACバイト一致、既存Metadata、768×768 JPEG attached_pic、全体デコード、シーク、一時FS後始末を確認。
- 初回・同一動画2回目保存、保存開始保留のタイムアウト後再試行、Chrome保存拒否によるinterrupted後の再試行、取得キャンセル後再試行を確認。保存はM4Aのみ、旧AACリンククリックはゼロ。
- Artworkドラッグ・ズーム・再編集・リセット、別Artwork、画像なし・不正画像のフォールバックを確認。
- Metadata欠損、CMAF、HLS/FFmpeg失敗後再試行、取得中動画切り替え・タブ終了を確認。意図的に発生させたエラーは回復経路の検証であり、成功扱いにはしない。
- background APIの模擬状態で、ID取得済みpausedは保存待ちのまま、保存量増加は保存中、完了は完了、10分超無進捗は自分のIDを取消してエラー復帰することを確認。
- 案内画面・既存編集画面の表示、狭い幅、長いタイトル・URLのレイアウトを確認。
- 変更17ファイルのJavaScript構文、manifest参照、MIT原文一致、差分の空白検査に合格。PNGにテキスト・EXIFメタデータなし。

## 実機で確認する内容 / Known Limitations

| 未確認・制限 | 回避方法・今後 |
| --- | --- |
| 実ニコニコ動画の最新配信・DOM・画像 | 拡張機能と動画ページを更新し、実動画の標準・高音質を保存して確認。仕様変更時は取得部分を調査 |
| ネイティブ保存先ダイアログ・許可待ち | Chrome側で許可・保存先を操作。保存待ち表示、待機継続、取消・再試行を確認 |
| 古い所有者不明AAC | Chromeで旧要求を取消す。NicoPocket所有要求だけを自動管理 |
| JPEG / PNGネイティブプレイヤー差 | QuickTime / Music / FinderでArtwork・再生・シークを比較。現版はJPEG維持 |
| 大容量・長時間動画 | ブラウザメモリと同梱FFmpeg制限。全体30分上限あり |
| 編集ウィンドウを閉じた後のArtwork | 永続保存なし。保存前に編集・適用する |
| 同名ファイル | Chromeの連番でファイル名が変わる場合あり。metadata.titleは編集後の正規化値を維持 |

利用環境での最終確認: 起動・長いタイトル・Metadata・Artwork再編集 → 初回保存 → 同一動画再保存 → 別動画 → 保存先待ち → キャンセル・中断後再試行。各保存がM4Aのみで、音声・Artworkが対象動画と一致することを確認する。

## センシティブ情報

変更した全17ファイルのテキストとPNGを検査済み。センシティブ情報の混入なし。資格情報、個人情報、ローカルパス、固定拡張機能ID、実サイトのセッション・署名付き一時URLをリポジトリへ記録しない。合成検証ログ・プロフィール・出力メディアはリポジトリ外に置く。

## 推奨コミット構成（実行しない）

### 1. feat: finalize NicoPocket branding and local UI

対象: manifest.json、options.html、pocket/about.js、pocket/about.css、pocket/iconsの4画像、pocket/window.html。

目的: NicoPocket名称・既存ロゴ・個人利用版表記・使い方案内へ統一し、不要な旧設定UIと大百科適用を整理。

詳細:

- Unify extension branding and render icons from the existing NicoPocket logo.
- Replace legacy settings with local-install usage and save guidance.
- Preserve increasing internal versioning and display personal-use version 1.0.0.
- Remove obsolete origin trial data, encyclopedia scripts and public options exposure.
- Verify fresh-install branding, icon dimensions and the help page in Chrome.

### 2. fix: monitor pending saves and harden local download defaults

対象: pocket/background.js、pocket/window.js、pocket/aac-bridge.js、dist/utils.js、options.js。

目的: 保存ID取得後の待機と保存中を見分け、pausedを即エラーにせず、所有保存の無進捗を監視する。旧初期設定への対応と不要ログ整理。

詳細:

- Monitor only the current job's download and distinguish waiting from writing.
- Keep paused saves pending, with cancellation and inactivity timeout recovery.
- Supply required acquisition defaults without changing upstream media processing.
- Clarify Series / Album and remove unnecessary argument and internal-object logs.
- Verify repeated M4A saves, interruption recovery, five quality cases and exact AAC bytes.
- Preserve metadata, JPEG attached pictures and temporary-file cleanup.

### 3. docs: finalize personal-use documentation and credits

対象: README.md、LICENSE、PHASE10.md。

目的: 完成済み機能・ローカル導入・権限・既知制限・ライセンスと検証範囲を整理。

詳細:

- Document the completed personal-use workflow and stream-selection rules.
- Record permission use, save-wait limits and user-controlled Chrome prompts.
- Retain JPEG pending native-player comparison and document bundled FFmpeg build flags.
- Preserve the upstream MIT license and third-party credits.
- Separate synthetic regression results from remaining live-site and player checks.

## 今後の任意改善

実機結果に基づくPNG採用、Artwork状態の永続化、配信仕様変更への追随、保存待ち表示のさらなる精度改善。複数サイト・一括取得・再エンコード・全面アーキテクチャ変更はこの完成版の対象外。
