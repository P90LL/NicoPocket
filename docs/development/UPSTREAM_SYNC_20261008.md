# upstream v4同期（2026-10-08）

## 対象と開始状態

- 作業ブランチ: `codex/chore/upstream-sync-v4-20261008`
- 基準: `nico-pocket-main`
- 開始HEAD: `9ed5e92`
- fetch済みmerge対象: v4の`81b1338`（タグMetadata追加PRのmerge）
- 共通祖先: `321d497`
- ユーザーがmerge開始済みで、`nico_downloader/dist/utils.js`が競合中だった。
- 新しいfetch、コミット、プッシュ、ブランチ変更は実行していない。

## 実際のupstream差分

共通祖先からmerge対象までの変更は`dist/utils.js`の7行追加のみ。

1. `(Nicovideo.video_tags || []).join(", ")`をUTF-8向けに変換する。
2. FFmpegへ`-metadata keywords=...`を追加する。

今回の差分にはHLS、配信元、API、動画情報取得、バイナリ、manifestの更新はなかった。upstreamの既存コードにある旧保存やDescriptionは今回新規追加された変更ではない。

## 競合と解消方針

| 競合ファイル／箇所 | 解消 |
| --- | --- |
| `nico_downloader/dist/utils.js`の`runFFmpeg_m3u8` | タグ保存の意図を共通Metadata処理へ手動統合し、実行部分はNicoPocketの既存M4A専用実装を維持 |

upstream側の関数を丸ごと採用すると旧AAC／MP4出力、旧Metadataマッピング、保存リンク、ページUIを含む基盤へ戻るため採用しなかった。追加7行の意味をNicoPocket共通Metadata処理で実現し、`utils.js`最終内容は開始HEADと同一にした。単純なtheirs採用はしていない。

競合ファイルだけを解決済みとしてindexへ登録した。既存追跡ファイルがdist除外規則の対象だったため、その1ファイルに限定して明示登録した。その他の新規変更はworking treeに残している。unresolved filesは0件。MERGE_HEADを維持し、merge完了コミットはユーザー操作待ち。

## 取り込んだ内容とデータフロー

```text
既存NicovideoClass.JsonToTags（video_tagsと同じ取得元）
↓
NicoPocketVideo.readCurrent: videoTags
↓
backgroundのcontext／ジョブMetadataスナップショット
↓
NicoPocketMetadata.build: keywords
├ 保存前プレビュー: Tags
└ 既存utils.js: 同じ共通MetadataをFFmpegへ渡す
↓
Metadata・Artwork付きM4A
```

区切りはupstreamと同じ`, `。タグは取得順を維持し、文字列だけを許可し、制御文字を除去・前後空白をtrimする。防御上の上限は50件、各500文字。非配列、欠損、空のタグはkeywordsを省略する。既存タグgetterが不正データで失敗しても音声保存は続行する。

Tagsは自動取得・読み取り専用。新しい編集UIやプリセット項目は増やしていない。Metadata編集によるkeywords上書きも受け付けない。表示と出力は同じ共通生成関数を利用する。

## 維持したNicoPocket仕様

- M4A専用出力、audio/mp4、専用保存経路、出力所有者判定、Blob／FS後始末。
- 192 kbps以下はcopy。標準で192 kbps超だけAAC-LC 192 kbpsへ再エンコード。高音質はcopy。品質不明は既存フォールバック。
- 保存名とmetadata.title、Artist、Album Artist、Genre、Series / Album、Video ID、Video URL、Date、Creation Time。
- Metadata編集、Artist複数行、Genre標準／追加／カスタム、JSON version 2と旧形式移行。
- Artworkの中央クロップ、Drag／Zoom、768×768 JPEG／品質0.9、attached picture、画像失敗時のfallback。
- ダークUI、進捗、モーダル入力遮断、focus trap、同一動画連続保存、retry、cancel、SPAとstale job対策。

Description、publisher、旧comment／Artist／Albumマッピング、旧AAC保存、旧保存リンク、旧ページ進捗や保存用clickは復活させていない。既存の配信元取得用の限定UI操作は変更していない。

## 変更ファイル

- `nico_downloader/pocket/video-info.js`: 既存getterからタグを取得。
- `nico_downloader/pocket/metadata.js`: 共通タグ正規化とkeywordsマッピング。
- `nico_downloader/pocket/background.js`: タグをwhitelist contextとジョブへ保持。
- `nico_downloader/pocket/window.js`: MetadataプレビューにTagsを表示。
- `README.md`: 自動取得Tags／keywordsの説明1行だけを追記。
- `docs/development/UPSTREAM_SYNC_20261008.md`: 本記録。
- `nico_downloader/dist/utils.js`: 競合解消対象。最終内容は開始HEADと同一で差分なし。

## 合成回帰検証

分離した検証用Chromeで、実際の拡張コードと同梱ffmpeg.wasmを使用。合成動画JSON、HLS、Artworkで検証した。実サイト確認とは別。

- Metadata単体: 既存マッピング、Artist複数行、空値省略、読み取り専用項目と日時。
- Keywords単体: 日本語・取得順・区切り、欠損／不正値省略、非編集、件数制限。
- Genre単体: 固定ID、storage移行、version 1／2、未知IDと重複拒否。
- Metadata／Genre UI: ON／OFF、追加・編集・削除、カスタム、Artist／Album Artist／Album、Apply／Cancel／Reset、プリセット、JSON Import／Export、focus、狭い画面、SPA初期化。
- Tags: 実際のwatch JSONからcontextへ取得し、プレビューとM4A keywordsが一致した。タグなしの別動画ではTagsを省略し、前動画のタグが混入しなかった。
- Metadata付きM4A: 8件で保存成功。既存7ケースのタグと新keywordsを確認し、AACバイト一致、768×768 attached picture、デコード、シーク、FS後始末を維持した。
- 音質: 128のみ、128 / 192、128 / 192 / 256、256のみ、品質不明を標準／高音質の計10ケースで確認した。標準256入力はAAC-LC平均192045 bps、copy対象はAACバイト一致。Metadata、keywords、Artwork、M4A保存、再生・シーク、FS後始末を確認した。
- 保存workflow: 初回／同一動画連続、保存待ちtimeout後retry、interrupted後retry、HLS／FFmpeg失敗後retry、取得中cancel後retry、別動画、Artworkなしfallbackに成功した。二重クリックと重複FFMPEG_ENDでも保存が重複しなかった。
- 旧出力: 動画の保存対象はM4Aのみ。AAC生成・旧保存入口を拒否する既存ガードを維持した。プリセットExportのJSONは明示操作によるバックアップとして別扱い。
- Artwork UI: Drag、Zoom、Wheel、Reset、Cancel、狭い画面の検証が通過した。

pocket配下のJSとutils.jsの構文確認、Git差分確認、競合マーカー検査、unresolved index確認が通過した。バイナリ・vendor・manifest・permissions・ライセンスへの変更はない。検証素材・ログ・ブラウザプロファイルはリポジトリへ追加していない。

## 実サイト確認・未解決事項

今回のupstream統合は実サイトでは未確認。ユーザー環境でTagsプレビューと保存M4Aのkeywords、標準／高音質、連続保存と再試行を確認する必要がある。

コード上の未解決競合はない。merge完了コミットは指示どおり未実行。既存の同種拡張機能との競合や品質不明時のcopy方針は変更していない。

## センシティブ情報チェック

変更した全ファイルと競合解消対象を確認した。ローカル絶対パス、ユーザー名、資格情報、署名付きURL、配信一時URL、実Extension ID、実サイト診断ログ、個人情報の固定値を含めていない。センシティブ情報の混入なし。不要な診断コードを追加していない。
