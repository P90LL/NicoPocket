# NicoPocket 1.0.0 個人利用版 — 最終完成監査

## 完成判定

**NicoPocket 1.0.0 個人利用版 完成。** NicoPocket単体での主要機能に重大な未解決問題は確認されなかった。ユーザー提供の実サイト結果と、今回のコード監査・合成回帰検証を分けて判断した。同種拡張との共存対応、新機能、大規模な再設計は行わない。

表示版は1.0.0（個人利用版）、内部versionは5.0.0.23。今回の監査だけでversionは更新しない。

## 今回の変更

| ファイル | 内容 |
| --- | --- |
| README.md | 内部versionの訂正、完成状態、実サイト確認、競合拡張、Troubleshooting、最新記録への案内 |
| nico_downloader/options.js | 旧DebugPrintを互換性保持の無作用関数へ変更。watch JSONや配信URLを出力しない |
| nico_downloader/nicovideodownloader_scripts.js | ボタン配置失敗ログを固定文言へ変更。外側catchの未定義変数参照も解消 |
| nico_downloader/dist/utils.js | 取得・メモリ関連エラーログへ例外本文やFFmpeg出力を渡さない |
| nico_downloader/pocket/aac-bridge.js | FFmpeg・音声取得のエラーログを固定文言へ変更 |
| nico_downloader/pocket/background.js | 保存状態監視のcatchログを固定文言へ変更 |
| FINAL_AUDIT.md | 本監査・完成判定・確認範囲・コミット案 |

保存・Metadata・音質・Artwork・UIレイアウト・権限・vendorバイナリは変更していない。無関係な資産移動や削除は行っていない。

## 保存経路

```text
NicoPocket Download
→ 動画・タブ照合 / 配信元準備
→ VideoDown → MovieDownload_domand → DownEncoder
→ HLS / CMAFのAAC音声を入力
→ FFmpeg: 音声copy + Metadata + JPEG attached_pic
→ 動画ID.m4a（仮想FS）
→ audio/mp4 Blob → 所有ジョブを照合して転送
→ 拡張ウィンドウの専用save.js
→ 正規化済み編集タイトル.m4a
```

音声は `-map 0:a:0 -c:a copy`、画像がある場合は `-map 1:v:0 -c:v copy -disposition:v:0 attached_pic`、出力は `-f mp4`。AAC codecとMP4 muxerは必要な内部形式であり、AACファイルや拡張子mp4のユーザー保存を意味しない。

最終保存リンク生成・clickはpocket/save.jsのみ。リンクは動画ページへ挿入せず、拡張ウィンドウ内の未接続要素を使用する。所有者、タブ、動画、ファイル名、MIME、ftypヘッダー、同一jobの既発行状態を確認してから保存する。旧DownloadLinkClick・旧保存ボタンメソッドは互換名のみ無作用。旧ページ進捗はNicoPocket所有ジョブで抑制。aac / mp4 / tmp / part / 隠しファイルをユーザー出力する稼働経路は確認されなかった。

## FIX6と競合拡張

実サイトログで追加AACの発行元IDはNicoPocketと不一致、発行元名は「ニコニコ保存」、NicoPocket保存jobとの対応なし。M4Aは自身の保存jobと対応していた。別拡張を無効化した後、ユーザーがAAC追加保存と不要な設定メニュー表示の解消を確認した。

相手側の設定click関数まで解析したものではない。NicoPocketの配信元準備による設定の一時操作と、後の未標識synthetic clickを区別した。別拡張機能のExtension ID、動画名、Download ID等の実値は保存していない。同種拡張との同時利用は非推奨、共存時の挙動は保証しない。問題時は競合拡張を無効化して新規タブで確認する。

一時診断モジュール、import、runtime ID表示API、Download診断監視、click capture、設定状態Observer、診断タイマー・カウンター・call siteラッパーは撤去済み。今回も実装内の残存なしを確認した。Chrome保存監視や配信元stage状態は通常運用に必要なため維持。

## manifest / 権限

| 対象 | 確認結果・用途 |
| --- | --- |
| name / short_name / action | NicoPocketで統一。popup / optionsは使い方案内 |
| icons | NicoPocket用16 / 32 / 48 / 128。参照先・画像寸法を確認 |
| storage | 設定・動画context・保存job・所有保存ターゲットの状態管理 |
| downloads | 自身のDownload作成・完了・中断監視、照合、キャンセル |
| nicovideo.cdn.nimg.jp / tn.smilevideo.jp | 現行・旧サムネイル取得。画像取得失敗フォールバックあり |
| www.nicovideo.jpのcontent scripts | 動画情報取得・起動導線・既存取得エンジン・bridge |
| web_accessible_resources | FFmpegと既存取得関連資産のみ。対象はニコニコ動画ホスト |
| tabs / scripting / 全URL権限 | 要求しない。tabsの基本操作は使用するが、tabs権限を要する任意タブ情報の収集は行わない |

必要な権限を維持。manifest参照ファイルの存在と実際の拡張読み込みを確認した。

## listener / observer / 後始末

- bridgeに重複導入guardあり。backgroundのlistenerはworker評価時、window / Artworkのlistenerはウィンドウ評価時に登録。SPA切替で増設しない。
- 起動導線のMutationObserverと周期配置は同じ冪等処理を呼び、既存ボタンを再利用する。保存を直接起動しない。
- FFMPEG_ENDのoutputProduced、保存転送のissued / saveReadyAt、二重実行フラグにより1job1保存に制限。
- Artwork dialogはinert、backdrop、Tab / Shift+Tab制御、focus復帰、wheel / pointer遮断、背面ページlockを使用。閉じる・ウィンドウ切断時に解除。
- Artworkの画像Bitmap / Blob URLを解放、ロードabort、世代番号・動画照合で混入防止。
- 保存Blob URLは完了・失敗・job切替・pagehide時にrevoke。
- 仮想FSのArtwork JPEGと出力M4Aは完了・エラー時にunlink。入力playlist / segmentはjobごとの新規coreに属し、次jobへ共有しない。すべての入力ファイルを個別unlinkする設計ではない。
- cancel / stale jobはabortし、監視interval / timeoutと取得中フラグを解除。FFmpegが同期実行中のcleanupは終了後に行う。

合成テストで同一動画連続保存、別動画、二重終了イベント、キャンセル、失敗後の再試行、Artwork / M4A FS残留なしを確認した。任意のChromeプロセス状態や全メモリの回収時刻まで保証する監査ではない。

## Metadata / Artwork / Audio / UI

| 項目 | 確認結果 |
| --- | --- |
| Title | 共通normalize後の編集タイトル。ファイル名stemとmetadata.title一致。Chromeの同名連番は別扱い |
| Artist | 取得した投稿者。欠損時は省略 |
| Video ID / URL | episode_id / comment。URLは正規動画URL |
| Genre / Series | genre / album。取得値のみ。シリーズ存在時の投稿者をalbum_artistに使用 |
| Date | 有効な投稿日時をdate / creation_time。欠損・無効値は省略 |
| Metadata preview | FFmpegと同じNicoPocketMetadata.buildを使用。長文折り返し・開閉あり |
| Artwork | 1:1、768×768 JPEG quality 0.9。未編集中央クロップ、Drag / Zoom / Reset / Cancel / Apply。JPEG stream copyのattached_pic |
| 画像失敗 | ArtworkなしM4Aへフォールバック。中間画像の保存要求なし |
| 標準音質 | 192 kbps以下の最高品質。該当なしは利用可能な最高品質 |
| 高音質 | 利用可能な最高bitrate。不明候補時は従来既定へフォールバック |
| 再エンコード | 音声c:a copyを維持。192 kbps強制変換なし |
| UI | ダーク固定、元タイトル / 保存タイトル、Metadata、進捗、完了、エラー、再試行、responsive、modal遮断を維持 |

PNGは採用しない。以前の合成検証では格納可能だが、一般的なネイティブプレイヤー互換性比較が未確認のためJPEGを維持。

## 不要コード・資産の扱い

機微な情報を含み得る任意DebugPrintと例外本文のconsole出力を整理した。固定文言のエラー・Artwork欠損警告は残す。同梱FFmpegの生成ランタイムを改造せず、稼働経路のprint / printErrで出力を扱う。

tool/以下の旧参考コード・旧options、manifestに含まれないdic_scripts.js / options_menu.js、旧アイコンは未使用または参考資産として保持。製品UI・保存経路へ接続されないことを確認した。旧関数名やコメント例まで機械的に削除しない。

PHASE / FIX記録は開発時点の履歴として保持し、READMEから現在の完成監査・FIX6を案内した。記録にある古いAAC出力や保留事項は現在仕様を意味しない。大規模なdocs移動は行わない。

## センシティブ情報・バイナリ

- 監査開始時の全62ファイル（Git内部を除き、同梱・ignored資産も含む）と、新規監査記録・最終差分を確認。
- ローカルパス、実ユーザー名、固定Extension ID、実資格情報、署名付きURL、HLS一時URL、実サイト診断ログを検査。該当なし。
- token / cookie / credentials / session等は動作上の識別子・API引数・説明であり、実値の埋め込みではない。
- FFmpeg生成ランタイムにある仮想FSのhomeとweb_userは同梱環境の既定値で、実際の利用者名・ローカルホームではない。バイナリ・生成コードを改変しない。
- 全PNGのチャンクを確認。EXIF / XMP / IPTC / コメント / テキスト / GPS / 作者情報なし。SVGにも個人情報なし。アイコン寸法を確認。
- ローカル検証用プロファイル、ログ、生成M4A、画像はリポジトリ外で管理し、コミット対象へ追加しない。

**センシティブ情報の混入なし。** Git履歴全体の秘密情報探索・実行中Chromeプロファイルの内容調査は対象に含めない。

## LICENSE / Credits

ルートと拡張内のLICENSE本文が一致し、MIT LicenseとCopyright (c) 2021 masteralice3104を維持。READMEでフォーク元masteralice3104/nico_downloaderとFFmpeg等のCreditsを表示。

第三者FFmpegはプロジェクトMITのみでは扱わない。READMEの既存GPL / nonfree構成への注意と個別ライセンスの区別を維持した。本監査では法的再配布条件を再判定せず、個人利用・ローカル導入を対象とする。

## 今回の合成回帰検証

| 検証 | 結果 |
| --- | --- |
| 旧入口・保存境界 | 旧リンク生成不可、AAC名 / MIME / ADTS偽装拒否、二重endは1保存、新jobは保存可 |
| 音質 | 128のみ、128 / 192、128 / 192 / 256、256のみ、品質不明 × 標準 / 高音質、10件のM4Aのみ |
| メディア | AACバイト一致、Metadata、768×768 attached_pic、デコード、シーク、仮想FS後始末 |
| 保存workflow | 初回、同一動画連続、SPA別動画、保存待ちtimeout後retry、interrupted後retry、HLS / FFmpeg失敗後retry、cancel後retry、画像なしfallback |
| UI | Drag / slider / wheel / preview / cancel / reset、背面inert、Tab trap / focus復帰、スクロール遮断、狭い画面、dark固定 |
| 静的確認 | 全JavaScript構文、manifest資産存在、LICENSE一致、git diff整形、診断残存なし |

テスト用Chromeは一時プロファイルを使用し、配信通信は合成データへ置換。普段のChrome・実サイトを操作していない。初回のsandbox内Chrome起動は環境制限で失敗したため、許可された隔離検証で再実行して通過。

## 実サイト結果と未確認事項

ユーザーが確認済み: M4A保存、AAC追加なし、競合拡張無効化で設定問題解消、Metadata、Artwork、音質、同一動画連続保存、再試行、dark UI、Artwork編集、専用保存経路。

今回のログ整理後の実サイト再確認は未実施。ネイティブプレイヤー個別のArtwork表示比較、全動画・全Chrome許可状態、任意サイト変更への対応は未確認。合成の保存待ち / 中断試験は実際の許可ダイアログを自動操作していない。

## Known Limitations

- 個人利用・ローカル導入向け。Chrome Web Store公開予定なし。
- 同種拡張の共存は保証しない。問題時は競合拡張を無効化して確認。
- Chromeの許可・保存先UIは自動操作しない。保存待ちをcancelしてretry可能。
- ニコニコの配信・DOM・音質・画像ホスト変更や実サイト状態に依存。
- 長時間動画のブラウザメモリ / 同梱FFmpeg制約あり。
- PNGのプレイヤー比較は未確認で、現行はJPEG。
- Artwork編集はウィンドウ内で保持し、閉じた後は永続化しない。

これらを仕様上の制限として記録し、追加機能提案は完成判定の条件にしない。

## Git差分・コミット案

一時ログ・プロファイル・メディア、無関係な削除、画像差分、vendorバイナリ差分なし。CRLFを使用する旧ファイルは維持。機能に必要な取得コードは削除していない。コミット・プッシュは未実行。

推奨は2コミット。GitHub Desktopで一括にする場合は下記の一括版を使用できる。

### 1. fix: 開発ログの情報出力を抑制

対象: options.js、nicovideodownloader_scripts.js、dist/utils.js、pocket/aac-bridge.js、pocket/background.js。

目的: 通常利用に不要なwatch情報・配信URL・例外本文の出力をなくす。

詳細:
- DebugPrintの呼び出し互換性を維持して無作用化
- 取得・FFmpeg・保存監視のログを固定文言へ統一
- 起動処理のcatch内にある未定義変数参照を解消
- M4A / Metadata / Artwork / 音質の既存処理を維持
- 保存境界、10音質保存、失敗後retry、modal回帰を確認

### 2. docs: NicoPocket個人利用版の完成監査を記録

対象: README.md、FINAL_AUDIT.md。

目的: 完成状態と確認範囲・既知制限を現在の実装に合わせる。

詳細:
- 表示1.0.0 / 内部5.0.0.23の整合性を修正
- 別拡張の競合原因と無効化手順をTroubleshootingへ反映
- 診断撤去、権限、LICENSE、画像メタ情報、センシティブ監査を記録
- 合成検証・ユーザー実サイト結果・未確認項目を分離
- 新機能や共存対応を追加せず完成版として整理

### 一括版

件名: chore: NicoPocket 1.0.0個人利用版の最終監査と整理

詳細:
- 配信情報や例外本文を出力し得る開発ログを整理
- READMEのバージョン・完成状態・競合拡張の案内を更新
- M4A専用保存、Metadata、JPEG Artwork、音質選択、再試行を維持
- 一時診断コードの残存なし、権限・LICENSE・画像メタ情報を確認
- 合成回帰とユーザー実サイト確認を分けて最終監査へ記録
- センシティブ情報の混入なしを確認
