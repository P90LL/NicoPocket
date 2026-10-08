# Phase 11: Genre専用プリセット

## 範囲

`codex/feature/metadata-edit`でGenreだけを標準・追加・カスタム入力へ変更した。基準は`nico-pocket-main`。Artist、Album Artist、Series / Albumの操作、Metadata生成、取得・保存処理は維持する。コミット・プッシュは実行していない。

## 標準ジャンル

| 固定ID | 表示名 |
| --- | --- |
| music-sound | 音楽・サウンド |
| vocaloid | VOCALOID |
| synthesizer-v | Synthesizer V |
| utau | UTAU |
| singing | 歌ってみた |
| performance | 演奏してみた |
| game | ゲーム |
| anime | アニメ |

新規利用時は8種類すべて有効。標準の定義は固定IDと表示名を分離し、設定画面ではチェックボックスによる表示ON／OFFだけを許可する。削除・編集ボタンは提供しない。

追加ジャンルはtrim・空文字禁止・1行・完全一致重複禁止。標準表示名との完全一致は、標準がOFFでも拒否する。追加順・編集位置を維持し、削除には確認を求める。

## storageとJSON version 2

```json
{
  "version": 2,
  "metadataPresets": {
    "artists": [],
    "albumArtists": [],
    "albums": [],
    "genres": {
      "enabledBuiltins": ["music-sound", "vocaloid", "synthesizer-v", "utau", "singing", "performance", "game", "anime"],
      "custom": []
    }
  }
}
```

`chrome.storage.local.metadataPresets`に上記内側のオブジェクトを保存する。versionはJSONバックアップに付ける。標準IDは定義済みのものだけを許可し、未知IDがあればImport全体を中止する。customは文字列配列で、trim・空文字除去・完全一致重複除去を行う。標準表示名と重複するcustomは拒否する。無関係なフィールドは保存しない。

既存の制限（各一覧1000件、1項目4000文字以内の1行、Importは1 MB以内）を維持する。

Exportは`nicopocket-metadata-presets.json`をversion 2で書き出す。Importは検証後、確認して全プリセットを置換する。キャンセル・不正JSON・未対応version・未知ID・型不正・標準名重複時には既存値を変更しない。

## 旧形式移行

旧storageの`genres`配列を初回読み込み時に移行・保存する。標準表示名と完全一致する値は対応固定IDを有効化し、それ以外はcustomへ移す。他3項目を保持する。旧配列が空なら有効IDもcustomも空とし、勝手に候補を増やさない。新規利用時の8種類有効とは区別する。

version 1 JSONも同じ移行処理で読み込む。version 2に旧配列形式が入っていた場合は形式不正として拒否する。移行全体の検証に失敗した場合は旧storageを上書きしない。

## Metadata編集UI

Genreチップを選択欄へ置き換えた。有効な標準と追加ジャンルをoptgroupで分け、カスタム入力の選択肢を常設する。自由入力欄はカスタム選択時だけ表示する。出力は従来どおり単一文字列。

現在のGenreが有効標準と一致すれば標準、追加と一致すれば追加、それ以外はカスタム入力として値を保持する。OFFの標準名や削除された追加ジャンルも元値を消さずカスタムへ移す。カスタム入力をstorageへ自動登録しない。

Apply前は下書きだけを変更し、Cancel／Escapeで破棄する。「自動取得値に戻す」で動画元Genreを同じ判定で復元し、標準の表示設定を変更しない。設定変更は次回表示・開いているモーダルへ同期し、下書き文字列を維持する。focus trapへselectを追加し、非表示の入力欄を除外した。

## 変更ファイル

- `nico_downloader/pocket/metadata-presets.js`: 標準ID、Genre検証、storage移行、JSON version 1／2。
- `nico_downloader/pocket/presets-settings.js`: 標準チェックボックスと追加Genre CRUD。
- `nico_downloader/pocket/metadata-editor.js`: 選択欄・カスタム入力・既存下書きへの接続。
- `nico_downloader/pocket/window.html`: Genre選択UI。
- `nico_downloader/pocket/window.css`: Genre入力幅・非表示時の表示制御。
- `nico_downloader/options.html`: JSON version表記。
- `nico_downloader/pocket/about.css`: 標準・追加見出しとチェックボックス、狭い画面対応。
- `README.md`: 現行Genre仕様とJSON移行を説明。
- `docs/development/PHASE11_METADATA_PRESETS.md`: 初期version 1の歴史記録であることを注記。
- `docs/development/PHASE11_METADATA_GENRE.md`: 本記録。

## 合成検証結果

実際の拡張コードを分離した検証用Chromeへ読み込み、合成動画情報・HLS・Artworkを使用した。実サイト確認とは別の結果。

- 単体: 新規初期値、固定ID、旧storageの一度だけの移行、version 1 JSON移行、version 2往復、Unicode、正規化、未知ID／標準重複／非文字列／改行の拒否、失敗時の非書き込みを確認した。
- 設定UI: 標準8種類ON／OFF、追加Genreの追加・直接編集・削除確認／キャンセル、標準名との重複登録／編集拒否を確認した。
- 編集UI: ON標準の選択、OFF標準の元値保持、追加候補の選択、削除後の値保持、カスタム入力、Apply／Cancel／Reset、設定同期時の下書き維持を確認した。
- JSON: version 2 Exportのファイル名と内容、version 1 Import移行、version 2全置換と重複・空文字正規化、キャンセル、不正・未知ID・標準名重複・非文字列時の既存値維持を確認した。
- M4A: 独自Genre適用1件と既存Metadata7ケース、計8件を保存した。ffprobeでGenreと他Metadata・Titleを確認し、AACバイト一致、768×768 attached pictureを維持した。デコード・シークを確認した。既存ケースでは仮想FSの後始末も確認した。
- Artist / Album Artist: チップ追加・重複防止・名前内スペース・改行からカンマ区切りへの保存を維持した。Albumのチップ置換・自由入力も維持した。
- モーダル: Tab／Shift+Tab、Escape、focus復帰、背面とDownload遮断、同一動画の値保持、SPA切替初期化、400px幅を確認した。
- Artwork: Drag、Zoom、Wheel、Cancel、Reset、狭い画面の回帰検証が通過した。
- 音質: 128のみ、128 / 192、128 / 192 / 256、256のみ、品質不明の5ケース×標準／高音質で10件のM4Aを確認した。AACバイト一致、Metadata、attached picture、デコード、シーク、FS後始末を維持した。

Metadata生成・FFmpeg・音質・Artwork・M4A保存・所有者判定の処理は変更していない。検証素材・ログ・プロファイルをリポジトリへ追加していない。

## 未確認事項

今回のGenre仕様は実サイトでは未確認。実際のChromeで候補表示、設定同期、旧設定移行とM4Aへの反映を確認する。複数設定ページの完全同時書き込みの排他制御は既存どおり追加していない。

## センシティブ情報チェック

変更ファイルのローカルパス・ユーザー名・資格情報・配信URL・実Extension ID・診断ログ・個人情報を検査した。センシティブ情報の混入なし。
