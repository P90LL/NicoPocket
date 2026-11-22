# Upstream 境界アーキテクチャと同期ガイドライン

本ドキュメントは、フォーク元（`upstream/v4`: `masteralice3104/nico_downloader`）の更新を取り込む際に NicoPocket 独自仕様の破壊やファイル競合を防ぐための 3 層境界設計と標準同期手順を定義します。

---

## 1. ディレクトリ・ファイルの 3 層分類

Chrome 拡張機能のロードルート `nico_downloader/` の下を、責務と変更主体に応じて以下の 3 層に分離しています。

### 第 1 層: Upstream 同期対象層（取得・HLS 解析・Wasm ランタイム基盤）

`upstream/v4` でのニコニコ動画仕様変更（DOM 構造・HLS マニフェスト解析・埋め込み JSON 抽出）に追従するための基盤層です。NicoPocket 独自の UI・M4A 変換・保存処理はこの層に直接書き込まず、第 2 層（`nico_downloader/pocket/`）に分離します。

| パス | 役割・同期方針 |
| --- | --- |
| `nico_downloader/func/nicojson.js` | 視聴ページからの動画 JSON / DOM メタデータ抽出（`NicovideoClass`）。Description 全文保存など NicoPocket 非採用機能を除き選択的に同期する。 |
| `nico_downloader/func/ndl.js` | HLS（`delivery.domand.nicovideo.jp`）マスタ・音声プレイリスト解決およびセグメント URL 構築（`NicoDownloaderClass`）。NicoPocket ジョブ所有権フックを維持しつつ同期する。 |
| `nico_downloader/dist/ffmpeg-core2.js` | 同梱 `ffmpeg.wasm` コアローダ（保護資産）。 |
| `nico_downloader/dist/ffmpeg-core.wasm` | 同梱 `ffmpeg.wasm` WebAssembly バイナリ（保護資産）。 |

### 第 2 層: NicoPocket 独自層（`nico_downloader/pocket/`）

NicoPocket 固有の UI・M4A 専用エンコード・メタデータ編集・アートワーク・バックグラウンド保存制御を担う層です。**`upstream/v4` の変更によって上書きしてはなりません。**

| パス | 役割 |
| --- | --- |
| `nico_downloader/pocket/download-runner.js` | 取得パイプライン起動エントリ（`VideoDown`, `MovieDownload_domand`）および視聴ページ起動ボタンの定期配置（旧 `nicovideodownloader_scripts.js` から分離）。 |
| `nico_downloader/pocket/m4a-encoder.js` | M4A 専用 FFmpeg 変換・AAC 192 kbps 再エンコード / copy・メタデータ & アートワーク埋め込み（旧 `dist/utils.js` から分離）。 |
| `nico_downloader/pocket/watch-metadata-bridge.js` | `page-bridge.js`（MAIN world）が捕捉した watch lazy 応答を受け取り `globalThis.NicoWatchMetadata` を提供する isolated-world ブリッジ（`func/nicojson.js` から分離）。 |
| `nico_downloader/pocket/page-bridge.js` | MAIN world で HLS マスタ URL と watch lazy メタデータを捕捉して postMessage 中継するブリッジ。 |
| `nico_downloader/pocket/aac-bridge.js` | バックグラウンドジョブ所有権の検証と取得パイプラインの実行制御。 |
| `nico_downloader/pocket/policy.js` | 標準ビットレート・アートワーク制限・サムネイル許可ホスト（`normalizeThumbnailUrl`）の共通ポリシー定義。 |
| `nico_downloader/pocket/video-info.js` | `NicovideoClass` を用いた視聴ページの動画メタデータ読み取り。 |
| `nico_downloader/pocket/audio-quality.js` | 標準（192 kbps 以下優先 / 超過時 AAC-LC 192 kbps）・高音質（最高音質 copy）の選択ロジック。 |
| `nico_downloader/pocket/metadata.js` | M4A タグマッピング（Description 非出力・複数 Artist・タグ `keywords` 正規化）。 |
| `nico_downloader/pocket/metadata-presets.js` / `presets/*` | Artist / Genre / Series プリセット管理と JSON インポート・エクスポート。 |
| `nico_downloader/pocket/artwork.js` | サムネイル / ローカル画像の 768×768 トリミング・JPEG 生成。 |
| `nico_downloader/pocket/window.*` / `metadata-editor.js` / `save.js` | 専用編集ウィンドウ UI と保存進捗管理。 |
| `nico_downloader/pocket/background.js` | Manifest V3 Service Worker（ジョブ状態・ダウンロード管理・モーダルロック制御）。 |

### 第 3 層: 互換・補助層

| パス | 役割 |
| --- | --- |
| `nico_downloader/manifest.json` | NicoPocket の最小権限（`storage`, `downloads`）、サムネイル `host_permissions`、スクリプト読み込み順序を定義。upstream の `manifest.json` で上書きしないこと。 |
| `nico_downloader/options.html` / `options.js` / `options_menu.js` | NicoPocket 案内・プリセット管理画面および旧ヘルパー関数互換スタブ。 |

---

## 2. 今後の `upstream/v4` 取り込み標準手順

1. **`git merge upstream/v4` の直接実行禁止**
   - `upstream/v4` をそのままマージすると、upstream 側の保存ボタン UI・旧 `nicovideodownloader_scripts.js`・`dist/utils.js`・`options.*`・`manifest.json` が復活・競合し、NicoPocket の M4A 専用設計を破壊します。
2. **差分確認（Read-only）**
   - `git fetch upstream` 後、`git log --oneline <前回同期SHA>..upstream/v4` および `git diff <前回同期SHA>..upstream/v4 -- nico_downloader/func/` で第 1 層（`func/nicojson.js`, `func/ndl.js`）の変更内容のみを精査します。
3. **選択的取り込み**
   - `nico-pocket-main` から作業ブランチを作成し、必要な動画情報取得・HLS 取得改善のみを選択的に反映します。
   - Description（説明文）保存、旧保存リンク UI、ショート動画用ボタン等の NicoPocket 非採用機能は除外します。
4. **自動検査スイートによる回帰チェック**
   - 取り込み後、必ず以下のテストを実行して全件 PASS を確認します:
     ```bash
     node --test --test-reporter=spec tests/*.test.mjs
     ```
   - `tests/upstream-boundary.test.mjs`、`tests/static-integrity.test.mjs`、`tests/security-hygiene.test.mjs` により、衝突ファイルの再混入・読み込み順序違反・所有権ガード欠落がないことが自動検証されます。
5. **同期記録の作成**
   - `docs/development/UPSTREAM_SYNC_YYYYMMDD.md` に同期対象コミット範囲・取り込み内容・除外内容・検証結果を記録します。
