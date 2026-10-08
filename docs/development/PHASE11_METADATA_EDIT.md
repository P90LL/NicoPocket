# PHASE11 — 保存前のMetadata編集

## 目的・対象ブランチ

作業ブランチ `codex/feature/metadata-edit`、基準 `nico-pocket-main`。開始時は基準と同一コミット、作業ツリーは変更なし。完成済みのNicoPocketに小規模なMetadata編集を追加し、取得・FFmpeg引数・保存方式の再設計は行わない。コミット・プッシュは未実行。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| nico_downloader/pocket/metadata.js | 共通normalizeMultiValue / normalizeEdits、編集対象4タグのみの上書き、空欄省略 |
| nico_downloader/pocket/metadata-editor.js | Metadataモーダル、下書き、Apply / Cancel / Reset、背面入力遮断とfocus管理 |
| nico_downloader/pocket/window.html | Download直下の編集ボタン、dialog、4編集欄と参照情報 |
| nico_downloader/pocket/window.css | Artworkと同じダークsurface / backdrop / border / radius、狭い画面の1列配置 |
| nico_downloader/pocket/window.js | 動画別編集state、初期値、プレビュー、保存要求への編集値追加、modal中Download遮断・終了後復帰 |
| nico_downloader/pocket/background.js | 共通Metadata関数の読み込み、許可タグだけを正規化してjobへ保持 |
| nico_downloader/pocket/content.js | 背面動画タブのlock表示をArtwork限定から共通の「編集中」へ変更 |
| README.md | Metadata編集仕様・使い方・本記録へのリンク |
| docs/development/PHASE11_METADATA_EDIT.md | 本記録 |

## 編集範囲

編集可能: Artist、Genre、Series / Album、Album Artist。

Titleは既存保存タイトルを常に利用し、Metadata側に別入力欄やoverrideを持たない。Video ID / Video URLは読み取り専用。Date / Creation Timeも今回は読み取り専用として従来の投稿日時を維持。不正な日時入力を受け付ける経路は追加していない。

バックグラウンドは編集対象4キーだけを取り出し、Title / Video ID / URL / Date等を任意メッセージで上書きさせない。値がない取得項目は推測せず省略する。

## 複数値・正規化

- ArtistとAlbum Artistはtextarea、1行1項目。
- LF / CRLF / CRを区切りとして共通処理で扱う。
- 各行をtrim、空行・空文字を除去、有効行を `, ` で結合。
- 半角・全角スペースを人物区切りにしない。名前内のスペースを維持。
- 既存のカンマを自動分割しない。名前そのもののカンマを誤分割しないため。
- Genre / Albumは単一文字列。制御文字をスペースへ変換してtrim。
- 空欄overrideは自動取得値へフォールバックせず、対象タグ自体を省略。
- 入力・正規化済み値には4000文字上限を設定。上限近辺でも二度の正規化が同じ値になることを確認した。

例: Artist入力「宮舞モカ」改行「弦巻マキ」は `宮舞モカ, 弦巻マキ`。Album Artist入力「IA English C」改行「重音テト」は `IA English C, 重音テト`。空行を挟んでも同じ結果になる。

## state / Apply / Cancel / Reset

`NicoPocketEditor.metadataOriginal`に現在動画の最初の自動取得タグを保持し、`metadataEdits`には適用した4項目の入力を保持する。元contextを書き換えず、入力中はフォームだけを変更する。

- Apply: 入力を編集stateへ反映、共通buildで左側プレビューを即更新。
- Cancel / Escape: 下書きを破棄。次回openでは適用値を再表示。
- Reset: 下書きを自動取得初期値へ戻す。Applyで確定、Cancelなら適用値を維持。
- 同一動画のstorage更新・進捗更新・再編集・再保存で適用値を失わない。
- タブID・動画ID・正規動画URLで取得元を識別。別動画・別タブ・context消失時にstateを初期化し、開いているMetadata dialogも閉じる。
- Apply直前に取得元一致と非Download中を確認。前動画の下書きを新動画へ適用しない。
- ウィンドウを閉じた後の編集state永続化は対象外。

## UI / 入力遮断

右側Downloadの直下へ「メタデータを編集」を追加。既存Artwork dialogと同じnative dialog、dark surface、backdrop、focus style、action buttonsを使用する。

背面shellをinert / aria-hiddenにし、スクロールを止める。内部にTab / Shift+Tabを制限、EscapeはCancel、close時に元focusとスクロール状態を復帰する。独自UI内のpointer / keyboard / wheel等が背面へ伝わらないよう制御。スクロールが必要な場合はdialog内だけを操作できる。

既存 `np:editor-modal` を再利用して動画タブもlockする。Artwork側のpresence接続とbackgroundの既存unlock処理をそのまま使い、ウィンドウ終了時のlock解除を維持。モーダル編集中はDownloadを無効化し、プログラムによるclickでも開始しない。終了時は既存job状態に合わせて復帰する。

## FFmpegへの接続

```text
編集フォーム → Apply → NicoPocketEditor.metadataEdits
→ 共通NicoPocketMetadata.build → プレビュー
→ Download時normalizeEdits → 既存np:aac-start
→ backgroundの4キー検査・正規化 → job.metadata.metadataEdits
→ 既存bridge → 既存dist/utils.jsのbuild
→ 従来の-metadata key=value → Metadata付きM4A
```

編集値が自動取得値より優先される。タグの名称・FFmpeg引数組み立て・保存方式は変更していない。Titleは共通normalize済みの保存名stemと一致。

HLS、配信元取得、M4A生成、AAC stream copy、save.js、所有者判定、二重保存防止、Artwork生成・JPEG埋め込み、音質選択は変更していない。Artworkは1:1 / 768×768 / JPEG quality 0.9 / attached_picを維持。

## 合成検証

普段のChromeとは別の一時プロファイルで、配信・画像を合成データへ置換した。テストスクリプト、ログ、画像、生成メディアはリポジトリ外に置く。

### 共通関数

- 編集なしの従来マッピング一致。
- Artist / Album Artist複数、LF / CRLF / CR、空行・空白行除去。
- IA English C、全角スペースを含む名前、名前のカンマを維持。
- 空欄でタグ省略、読み取り専用タグの不正overrideを無視。
- 欠損値・不正な取得日時は省略。
- 上限付近の正規化の再適用で値が変わらない。

### Metadata付きM4A 7件

編集なし、単独Artist、複数Artist / Album Artist、空行あり、名前内スペース、空欄省略、自動取得値へ戻す、の7ケースで生成成功。

ffprobeでtitle、artist、genre、album、album_artist、episode_id、comment、date、creation_timeを確認。編集後プレビューと一致し、空欄の4タグは存在しない。Creation TimeはUTC表記へ変わるため同じ日時として比較した。

全7件で保存ファイル名stemとtitle一致、AACバイト一致、768×768 JPEG attached_pic、M4A全体デコード・シーク、一時Artwork / M4AのFS削除を確認。ユーザー保存はM4Aのみ。

### UI / state

Apply後の即時プレビュー、同一動画再編集、Cancel、Escape、Reset後Cancel、別動画へ切替時のdialog終了・編集値初期化を確認。

Metadata modal中の背面inert、Download無効化・programmatic click拒否、Tab / Shift+Tab、focus復帰、背面動画lock解除、400px画面でdialogが収まることを確認。desktop / small画面のスクリーンショットを確認した。

### 既存機能の回帰

- 音質5ケース × 標準 / 高音質、10件M4Aのみ。編集なしの自動Metadata、AACバイト一致、Artwork、decode / seekを維持。
- 初回・同一動画連続・SPA別動画、保存待ちtimeout後retry、interrupted後retry、HLS / FFmpeg失敗後retry、cancel後retry、画像なしfallbackを確認。
- Artwork Drag / Zoom / wheel / Reset / Cancel / preview、背面lock、Tab trap、focus復帰、dark固定、狭い画面を確認。
- Artwork modal中にstate再描画が発生しても、close後にDownloadが復帰することを確認。
- JavaScript構文、Markdownリンク、git diff整形を確認。

## 未確認・仕様上の範囲

実サイトでの今回のMetadata編集後保存は未確認。合成検証の成功を実サイト確認とは扱わない。実機では複数名を適用して保存、Cancel / Reset、同一動画再編集・別動画切替を確認する。

Date / Creation Timeは意図的に読み取り専用。カンマの自動改行展開と編集stateのウィンドウ外永続化は実装しない。今回の必須範囲で未解決の不具合は確認されていない。

## センシティブ情報

変更全9ファイルを対象にローカル絶対パス・ユーザー名・固定Extension ID・資格情報・署名付きURL・一時HLS / CDN URL・実サイトログ・検証プロファイル情報を確認。固定値なし。テスト用の実パス・合成配信URL・拡張ID・生成データは記録へ転記しない。不要なconsole.log / console.debug / 診断コードを追加していない。

**センシティブ情報の混入なし。**

## コミット案

件名: feat: 保存前のメタデータ編集機能を追加

本文:
- Artist、Genre、Album、Album Artistの編集に対応
- ArtistとAlbum Artistを1行1項目で入力し、保存時にカンマ区切りへ正規化
- 空行を除去し、名前内スペースとカンマを維持
- 空欄にしたタグを省略し、自動取得値への復帰に対応
- Titleは保存タイトルと共通、Video ID / URLと日時は読み取り専用
- Apply / Cancel、同一動画の編集保持、別動画への混入防止を実装
- 編集値を共通Metadata生成関数でプレビューとM4Aへ反映
- モーダル中の背面入力とDownloadを遮断し、終了後に復帰
- 既存Artwork、音質、AAC stream copy、専用M4A保存を維持
- ffprobe、AACバイト一致、回帰検証、センシティブ情報チェックを実施
