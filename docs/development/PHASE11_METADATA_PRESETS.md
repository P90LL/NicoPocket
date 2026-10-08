# Phase 11: Metadataプリセット管理

## 範囲

作業ブランチは`codex/feature/metadata-edit`、基準は`nico-pocket-main`。既存のMetadata編集へ入力補助と設定管理を追加した。コミット・プッシュは実行していない。

対象はArtist、Album Artist、Genre、Series / Albumのみ。Titleは既存の保存タイトルと連動し、Video ID、Video URL、Date、Creation Timeは読み取り専用のまま。

## 変更ファイル

| ファイル | 役割 |
| --- | --- |
| `nico_downloader/pocket/metadata-presets.js` | 空の初期値、型検証、trim・重複除去、storage読み書き、JSON version 1 |
| `nico_downloader/pocket/presets-settings.js` | 追加・インライン編集・確認後の削除、JSON Import / Export、設定同期 |
| `nico_downloader/options.html` | 既存使い方ページへMetadata Presets欄を追加 |
| `nico_downloader/pocket/about.css` | 設定欄のダーク表示・折り返し・狭い画面対応 |
| `nico_downloader/pocket/metadata-editor.js` | チップから下書きへの追加／置換、一覧更新、設定ページへの導線 |
| `nico_downloader/pocket/window.html` | 4項目のチップ欄と管理ボタン |
| `nico_downloader/pocket/window.css` | チップの折り返しとスクロール |
| `README.md` | 使い方、保存場所、JSON仕様、制限 |
| `docs/development/PHASE11_METADATA_PRESETS.md` | 本記録 |

## storageとJSON

保存キーは`chrome.storage.local.metadataPresets`。値は次の4配列だけ。固定プリセットはなく、キーがない初回は空配列を返す。初回表示だけではstorageへ書き込まない。

```json
{
  "version": 1,
  "metadataPresets": {
    "artists": [],
    "albumArtists": [],
    "genres": [],
    "albums": []
  }
}
```

JSONバックアップにだけversionを持たせる。追加順を維持し、直接編集は元の位置を維持する。変更直前に最新storageを読み、古い一覧の値をそのまま全体へ上書きしない。

検証は4配列の存在・型、全要素の文字列型、trim、空文字除去、完全一致の重複除去。余分なフィールドは保存しない。未対応version、非文字列の混在、不正JSONでは書き込みしない。

1項目は4000文字以内の1行、各種類は入力配列で1000件以内、Importファイルは1 MB以内。名前内のスペース・日本語・記号は維持する。大文字小文字の独自正規化は行わない。

## 編集と同期

- Artist / Album Artistは入力の各行をtrimし、完全一致がなければ改行で1項目追加する。既存のカンマや名前内スペースで分割しない。
- Genre / Albumは1つの文字列で置き換える。自由入力を妨げない。
- チップクリックは下書きのみを変更する。Applyで確定し、Cancel / Escapeで破棄する。
- 「自動取得値に戻す」はMetadata下書きだけを戻す。プリセットには影響しない。
- 編集画面を開く際に毎回読み込む。`chrome.storage.onChanged`で編集中の一覧も更新するが、下書きは変更しない。
- チップは折り返し、長い値は改行する。大量の一覧はチップ領域内でスクロールし、既存モーダルのfocus trap・背面遮断を利用する。

## Import / Export

Exportは設定ページで明示操作されたときだけJSON Blobを生成し、`nicopocket-metadata-presets.json`として保存する。音声の保存経路には接続しない。Blob URLは保存要求後とページ終了時に解放する。

Importはファイルを解析・正規化してから「現在のプリセットをすべて置き換えます。続行しますか？」と確認する。承認時のみ4種類を全置換する。マージしない。キャンセル・検証失敗時は既存データを維持する。エラー・キャンセル後も操作可能な状態へ戻す。

## 既存機能への影響

Metadataの正規化・生成、取得エンジン、FFmpeg引数、音質選択、Artwork生成／埋め込み、ジョブ所有者判定、M4A保存は変更していない。既存のArtist / Album Artistの改行入力を、保存時に`, `区切りへ正規化する仕様を利用する。設定JSONの保存は利用者が明示的に選ぶバックアップで、動画Downloadの出力はM4Aだけ。

## 合成検証結果

分離した検証用Chromeに拡張機能を読み込み、合成動画情報・HLS・Artworkで確認した。実サイトの検証結果ではない。

- 共通モデル: 空の初期値、trim、順序、重複除去、型検証、余分なデータを保存しないこと、Unicode JSON往復、version／形式不正時の既存値維持、全置換に成功。
- 設定UI: 追加、直接編集、位置維持、重複拒否、削除確認・キャンセルに成功。
- Export: 正式ファイル名、version 1、4配列、日本語・記号・名前内スペースの保持に成功。
- Import: 全置換、重複・空文字正規化、キャンセル、不正JSON、欠損配列、非文字列、未対応versionのデータ維持に成功。
- チップ: Artist / Album Artist追加・重複防止、Genre / Album置換・自由入力、Cancelによる確定値維持に成功。
- 同期: 設定変更を開いている編集モーダルへ反映し、入力中の下書きは保持した。自動取得値に戻してもプリセットが残った。
- M4A: プリセット適用1件と既存Metadata編集7ケース、計8件の保存に成功。ffprobeでタグ反映・Titleを確認し、AAC音声バイト一致とattached pictureの維持を確認した。既存7ケースは全体デコード・シーク・仮想FS後始末も成功した。
- UI: MetadataモーダルのTab / Shift+Tab、Escape、focus復帰、Download遮断、元ページの背面遮断、同一動画の状態保持、SPA動画切替時の初期化を確認した。400px幅で横方向のはみ出しなし。設定ページと編集画面のスクリーンショットを目視確認した。
- Artwork回帰: Drag、Zoom、Wheel、Cancel、Reset、狭い画面のモーダルを確認した。
- 音質回帰: 128のみ、128 / 192、128 / 192 / 256、256のみ、品質不明を標準／高音質で確認した。10件のM4AでAACバイト一致、Metadata、attached picture、デコード、シーク、FS後始末を維持した。

検証素材・ログ・ブラウザプロファイルはリポジトリへ追加していない。

## 未確認事項

今回のプリセット追加機能は実サイトで未確認。実際のChromeで、オプションからの登録、編集モーダルから管理画面を開く導線、JSON往復、Apply後のM4Aを確認する。複数設定ページから完全に同時に書き込む競合の排他制御は追加していない。

## センシティブ情報チェック

変更した全ファイルを対象に、ローカル絶対パス・ユーザー名・資格情報・署名付き配信URL・実Extension ID・実サイト診断データを検査した。センシティブ情報の混入なし。固定の動画情報・配信URL・登録用サンプル値も実装へ含めていない。
