# upstream v4 選択的同期（2026-11-22）

## 対象と開始状態

- 作業ブランチ: `antigravity/chore-upstream-sync-v4`
- 起点ブランチ: `nico-pocket-main`（開始 HEAD: `8a58d50`）
- 対象 upstream 範囲: `upstream/v4` `a810990..b36a21f`（未取り込み 3 コミット）
  1. `57ed488`: 動画情報の全文取得と保存名の準備・固定を修正
  2. `dd06518`: 不正な保存設定の修復と確認状態の同期を改善
  3. `b36a21f`: 設定読込と動画切替の復旧・設定画面を改善
- 方針: `upstream/v4` をそのまま `git merge` せず、NicoPocket のメタデータ取得精度と動画切替時の安全性を高める変更のみを選択的に取り込み。

## 取り込んだ内容

対象ファイル: `nico_downloader/func/nicojson.js`

1. **同一動画 ID 判定ヘルパー `currentDecoratedVideoId` の追加**
   - `location.pathname` が `/watch/sm...` の場合のみ現在表示中の動画 ID を抽出し、DOM 補完時に別動画の情報を誤参照しないようにした。
2. **動画切替時の `page_counts` リセット（`page_counts_video_id` 管理）**
   - コンストラクタに `this.page_counts_video_id = ''` を追加し、`SetAll()` 冒頭および `ReadDecoratedPageMetadata()` 内で動画 ID が切り替わった際に `this.page_counts` をリセットするようにした。
3. **`ReadDecoratedPageMetadata()` による DOM メタデータ補完**
   - `[data-decoration-video-id]` 配下の描画済み DOM から、`video_title` / `video_registeredAt` / `page_counts`（`view`, `comment`, `like`, `mylist`） / `video_genre` / `video_series` / `video_owner` の空欄項目のみを補完する。
   - 説明文 `<p>` 内のリンク（`!description?.contains?.(link)`）を除外するフィルタを維持し、投稿者・ジャンル・シリーズリンクの誤取得を防止した。
   - Description（説明文）全文取得・`SetFullDescription` 呼び出し・説明文取得ログ出力は含めていない。
4. **`DownloadJson(video_sm)` の DOM フォールバック組み込み**
   - 埋め込み JSON（`server-response` / `#js-initial-watch-data`）が見つからない場合、`ReadDecoratedPageMetadata(video_sm)` で主要メタデータ（`video_title` / `video_owner` / `video_genre` / `video_series` / `video_registeredAt` のいずれか）を補完できれば、既存 `JsonTo*` アクセサ互換の合成 JSON を返すようにした（Description 依存条件は設けていない）。
   - DOM からも取得できない場合は従来通り `NicoWatchMetadata?.get(video_sm)` へフォールバックする。
5. **`CompletePageMetadata()` への `ReadDecoratedPageMetadata()` 追加**
   - 冒頭で `this.ReadDecoratedPageMetadata()` を呼び出し、既存の `NicoWatchMetadata`・埋め込み JSON・JSON-LD 補完と併用する。
6. **`GetPageTitle()` の見出しセレクタ優先度改善**
   - 通常動画の候補先頭に `document.querySelector("main h1.fs_xl.fw_bold")?.textContent` を追加し、従来の `document.querySelector("h1")?.textContent` を直後のフォールバックとして維持した。

## 除外した内容と理由

| 除外対象 | 対象コミット・箇所 | 除外理由 |
| --- | --- | --- |
| Description（説明文）全文取得機能 | `57ed488`（`nicojson.js` の `ReadFullDescription` / `SetFullDescription` / `EnsureFullDescription` / `description` postMessage 連携） | NicoPocket は Description を保存・利用しない仕様のため不要。 |
| upstream 保存ボタン UI・保存済みグレーアウト固定・ショート動画対応 | `57ed488`, `dd06518`, `b36a21f`（`ndl.js`, `nicovideodownloader_scripts.js`） | NicoPocket 独自のモーダル UI・同一動画の連続保存許可・M4A 専用フローと競合するため。 |
| upstream 設定画面・保存設定修復・README 更新 | `dd06518`, `b36a21f`（`options.*`, `README.md`） | NicoPocket 独自の設定体系・ドキュメント構成と競合するため。 |

## 維持した NicoPocket 仕様

- `nico_downloader/func/nicojson.js` の `NicoWatchMetadata` 受信リスナー（`#10` で導入した `page-bridge.js` 連携）。
- M4A 専用出力・音質選択（192 kbps 以下 copy / 標準 192 kbps 超 AAC-LC 再エンコード / 高音質 copy）・Artwork 処理・タグ `keywords` 付与。
- Description 非保存・旧保存リンクや旧 AAC 出力の不採用・同一動画の連続保存許可。
- `nico_downloader/pocket/*`、`nico_downloader/dist/*`、`nico_downloader/manifest.json`、ライセンスおよび既存開発ドキュメントへの変更なし。

## 変更ファイル

- `nico_downloader/func/nicojson.js`: DOM メタデータ補完、`DownloadJson` フォールバック、`page_counts` 動画切替リセット、`GetPageTitle` 優先セレクタ追加。
- `docs/development/UPSTREAM_SYNC_20261122.md`: 本同期記録。

## 検証結果

### 構文チェック（PASS）

- `node --check nico_downloader/func/nicojson.js`: PASS
- `nico_downloader/pocket/*.js` 全ファイルの `node --check`: PASS

### 単体ロジック検証（Node モック DOM 検証: 6/6 PASS）

1. `ReadDecoratedPageMetadata()`: `[data-decoration-video-id]` モック DOM からタイトル・投稿日時・ジャンル・シリーズ・投稿者・各種カウントが補完され、説明文 `<p>` 内リンクが誤取得されないこと、別動画 ID の DOM が無視されることを確認。
2. `DownloadJson()`（DOM フォールバック）: 埋め込み JSON 不在かつ Description 不在の条件で合成 JSON を返し、`JsonToId` / `JsonToTitle` / `JsonToUser` / `JsonToGenre` / `JsonToSeries` / `JsonToRegisteredAt` および各カウントが取得できることを確認。
3. `DownloadJson()`（`NicoWatchMetadata` フォールバック）: 埋め込み JSON・DOM ともに不在時に `NicoWatchMetadata.get(videoId)` 経由で補完されることを確認。
4. 動画切替時（`sm1` → `sm2`）の `page_counts` リセット: 前動画のカウントがリセットされ混入しないことを確認。
5. `GetPageTitle()`: `main h1.fs_xl.fw_bold` が優先され、不在時に `h1` へフォールバックすることを確認。
6. `CompletePageMetadata()`: `ReadDecoratedPageMetadata()` 経由で欠損メタデータが補完されることを確認。

### 実サイト確認・未解決事項

- **実サイト未確認**: 本同期の変更は Node 上のモック DOM による構文・単体ロジック検証のみを実施しており、実際のニコニコ動画視聴ページ（SPA 遷移を含む）での動作確認は未実施。実環境での動画情報表示・動画切替・M4A 保存確認が必要。

## センシティブ情報チェック

- 変更ファイル（`nico_downloader/func/nicojson.js` および本ドキュメント）を確認済み。
- ローカル絶対パス、ユーザー名、資格情報、署名付き URL、配信一時 URL、実 Extension ID、個人情報の固定値は含まれていない。
