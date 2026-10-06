# Phase 9: Downloadと表示の仕上げ

## 実装範囲

既存取得・同梱FFmpeg・音質選択・M4A生成を維持し、進捗、保存監視、再試行、Metadata確認、元タイトル表示を統合した。コミット・プッシュは実行していない。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| `nico_downloader/pocket/aac-bridge.js` | 既存進捗の転送、FFmpeg状態通知、旧保存リンク実行抑止、最終M4Aだけの保存、Blob解放 |
| `nico_downloader/pocket/background.js` | 進捗保持、ユーザーキャンセル、Chrome中断・保留対応、古い所有済み保存要求の照合 |
| `nico_downloader/pocket/metadata.js` | UIとFFmpegが共用する既存タグマッピング |
| `nico_downloader/dist/utils.js` | NicoPocket M4A経路のMetadata生成を共通関数へ接続 |
| `nico_downloader/manifest.json` | 共通Metadata関数の読み込み |
| `nico_downloader/pocket/window.js` | 進捗・キャンセル・再試行・Metadata一覧・元タイトルの表示 |
| `nico_downloader/pocket/window.html` | Metadata開閉欄、元タイトル、進捗バー、キャンセルボタン |
| `nico_downloader/pocket/window.css` | 既存デザインに合わせた追加要素、狭い画面・長い値の折り返し |
| `nico_downloader/pocket/artwork.js` | Artwork変更通知、Download中の編集ボタン抑止 |
| `PHASE9.md` | 実装・検証・制限・コミット案 |

## 進捗UI

既存`ButtonTextWrite`の取得パーセント → 既存`np:aac-event` → backgroundの`np:aacJob.progress` → windowの数値・progress要素。

取得率は既存HLS取得全体の率を利用し、整数値が変わった時だけ通知する。NicoPocket経由では元ページの進捗書き換えを抑止し、入口ボタンは維持する。通常のnico_downloader経路では元の関数を呼ぶ。

同梱FFmpegの`main`開始を`processing`として通知する。MetadataとArtworkは同じFFmpeg呼び出しで設定するため、独立した処理段階のような架空のパーセントは表示しない。

表示状態:

- 取得開始
- 音声取得と既存取得率
- M4A生成（Metadata・Artwork設定を含む）
- 保存中
- 完了
- エラーと再試行

## 保存・Chrome許可・旧AAC経路

元コードには、取得開始時の`DownloadLinkClick`と汎用保存リンクを実行する導線がある。NicoPocket処理中はこの汎用ハンドラーを抑止し、残っている古いリンクを削除・Blob URLを解放する。

最終保存では、生成済みリンクのBlob URLと`.m4a`拡張子を確認し、backgroundへ所有URL・ジョブIDを登録してから、そのM4Aリンクだけを一度クリックする。汎用`DownloadLinkClick`は呼ばない。AACやJPEGの保存要求は作らない。

Chrome APIによる直接保存も検証したが、この環境ではM4A Blobが`video/mp4`と判定され、指定した`.m4a`が`.mp4`へ変更された。最終実装には直接API保存を採用せず、M4Aリンク方式を維持した。Chrome APIは保存監視と自分の要求のキャンセルに使う。最終方式は`.m4a`と`audio/mp4`を維持する。

- 保存開始を60秒確認できなければChromeの許可・保存先確認を案内し、ロックを解除する。
- ChromeがDownload IDを通知した後は完了・中断イベントで管理し、正常な大容量保存を60秒で誤キャンセルしない。
- 中断・保留イベントではエラー表示へ戻し、自分のDownload IDだけをキャンセルして再試行を可能にする。
- UIのキャンセルボタンでも現在のジョブだけを終了し、ページリロードなしで再試行できる。
- 所有した保存URLとジョブIDをセッション内で最大20件保持する。終了・失敗後や別ジョブの遅延Downloadイベントは照合してキャンセルする。無関係な保存要求には触れない。
- Chromeの許可ダイアログを自動承認しない。可視ダイアログ自体を直接検出するAPIも使用していない。

実サイトの「許可後にAACが保存される」現象は今回再現していない。旧リンクが発火し得る入口をコードで確認し、NicoPocketの新規処理では抑止した。以前からChromeに保留されていた所有者不明のAAC要求まで取り消せたとは主張しない。

## 同一動画の連続保存

既存のジョブID・タブ・動画照合を保ち、終了・エラーで実行フラグ、動画読み込みフラグ、保存リンク、Blob URL、タイマー、Artwork参照を解放する。次の要求は新しいジョブID・品質選択・FFmpeg coreで開始する。仮想FSのM4AとArtwork削除、`last_save_sm`の開始時リセットを維持する。

ページ全体の再読み込みや大規模な初期化は追加していない。

## Metadata・元タイトル

FFmpegで使っていたマッピングを`NicoPocketMetadata.build`へ移動し、UIとFFmpegの両方で同じ関数を呼ぶ。表示専用のMetadata生成処理は作らない。

- Title: 正規化した編集タイトル
- Artist: 投稿者
- Video ID: `episode_id`
- Video URL: `comment`
- Genre: 取得したジャンル
- Album: シリーズ名
- Album Artist: シリーズがある場合の投稿者
- Date / Creation Time: 取得できた有効な投稿日時
- Artwork: 生成済みJPEGの有無

空の値は共通関数で省略する。creation_timeはFFmpegへ渡す元の日時を表示し、コンテナ内ではUTC表記へ変わる場合がある。Artworkは別入力なので有無・形式を表示する。

Metadata一覧は開閉式にし、タイトル編集に追従する。元タイトルは編集欄の前へ読み取り専用で表示する。Download中は編集タイトル、音質、Artwork編集の入口を抑止する。

## Artwork: PNG検証と最終形式

同梱ffmpeg.wasmへ768×768 JPEGとPNGを入力し、いずれも`-c:a copy -c:v copy -disposition:v:0 attached_pic`でM4Aへ格納できた。

| 合成画像 | 画像サイズ | M4Aサイズ |
| --- | ---: | ---: |
| JPEG | 9,713 bytes | 27,365 bytes |
| PNG | 3,507 bytes | 21,159 bytes |

比較画像は単純な色分け画像。PNGが小さい結果を実サムネイル一般へ適用しない。

両形式で、ffprobeによるattached picture・768×768・Metadata確認、入力と出力のAACバイト一致、画像バイト一致、全体デコード、途中シーク、仮想FS削除を確認した。

最終Artwork形式は従来の768×768 JPEG・品質0.9。PNGの一般的な対応プレイヤーでのArtwork表示を比較できていないため、既存経路の安定性を優先してJPEGを維持する。PNGが利用不能とは判断していない。

## host permissions見直し

権限追加・変更なし。既存の次の2ホストを維持する。

- `https://nicovideo.cdn.nimg.jp/*`: 現在のサムネイル配信ホスト。
- `https://tn.smilevideo.jp/*`: 既存サムネイル配信との互換性。

全URLや親ドメイン全体へ広げた権限ではない。動画ごとに変わる画像パスを固定して取得を不安定にしないため、ホスト単位の範囲を維持した。実サイトで現行・旧サムネイルを確認することは残る。

## 合成データ・実行検証

取得応答だけを合成データへ置換し、実際の拡張機能・既存HLS/CMAF・同梱FFmpeg・Chrome保存を使用した。

- 初回・同一動画2回目をページリロードなしで保存。
- 標準・高音質の5ケース×2選択、計10回の連続保存。期待した音声候補とAACバイト一致。
- Metadata・JPEG Artwork・attached_pic・保存名とtitle・デコード・シーク維持。
- 専用Chromeプロファイルの通常保存でも編集名`.m4a`と実ファイルを確認。
- 取得率・FFmpeg処理・保存・完了の状態履歴を確認。
- 古いAACリンクのクリック回数0、生成されたDownload要求はM4Aのみ。
- 保存クリックを保留した合成ケースで開始タイムアウト後に再試行成功。
- Chromeの保存拒否設定で実際のinterruptedを確認し、許可設定へ戻して再試行成功。可視の許可ポップアップ操作を検証したものではない。
- 取得中キャンセル後にページリロードなしで再試行成功。
- 遅延所有Downloadのイベント分岐を合成イベントで確認。無関係な要求はキャンセルされない。
- Metadata一覧と実ファイルのタグを比較し、元タイトル更新を確認。
- デスクトップ・狭い画面のスクリーンショットを確認。
- 既存Phase 7回帰検証: 別動画保存、Artwork欠損・破損フォールバック、Metadata欠損、CMAF、プレイリスト失敗、FFmpeg失敗後の再試行、動画切り替え中断、タブ閉鎖、仮想FS残留なし。
- PNG/JPEG互換性の検証は上記のとおり。
- JavaScript構文、manifest JSON、差分の空白チェック。

## 未解決事項・実サイト確認

| 未解決内容 | 原因・再現条件 | 現在の回避方法 | 今後の候補 |
| --- | --- | --- | --- |
| Chrome可視許可ポップアップと許可後保存の実機確認 | 合成検証では保存拒否・中断・開始待ちを検証。実サイトの許可UIは未再現 | Chrome側の許可・保存先を確認し、必要ならUIからキャンセル・再試行 | 実際のChrome設定・イベント順を記録して調整 |
| Phase 9以前から残る所有者不明AACキュー | 古い要求にはNicoPocketの所有URL・ジョブ記録がない | Chromeの既存保留要求を手動でキャンセル。新規NicoPocket要求で再確認 | 安全に所有者を識別できる情報がある場合のみ対応 |
| Download ID取得後の保存先ダイアログ待ちを自動識別 | pausedやinterruptedが通知されないダイアログ状態は断定できない | 保存先を選ぶか、NicoPocketのキャンセルで解除して再試行 | 実機で通知される状態を確認。通常の大容量保存を誤中断しない方法を検討 |
| PNGの対応プレイヤー比較 | 同梱FFmpegとffprobeでは成功。ネイティブプレイヤー表示は未確認 | JPEGを維持 | 対象プレイヤーでJPEG/PNG同条件比較後に採用判断 |
| 実配信・画像ホストの最終確認 | 合成配信での取得・画面表示のみ | 現行2ホストを維持 | 実サイトで動画・音質・サムネイルを変えて確認 |

実サイトでは、初回・同一動画再保存・別動画、標準/高音質、Download許可・キャンセル・中断後の再試行、旧AACが保存されないこと、M4A再生・シーク・Artwork表示を確認する。

## センシティブ情報チェック

変更した全10ファイルについて、ローカル絶対パス、macOSユーザー名、APIキー、Token、Cookie、Authorization、セッション値、署名付きURL、個人情報、一時配信URL、環境固有値、実機検証データを確認する。合成データ・ブラウザプロファイル・スクリーンショット・検証ログはリポジトリへ追加していない。

センシティブ情報の混入なし。

## 推奨コミット構成

今回は一括コミットを推奨する。windowの進捗とMetadata表示、共通Metadata関数・読み込み順が同じ差分で接続されるため、ファイル単位で機械的に分けると途中の状態が動作しなくなる可能性がある。

件名: `feat: finalize NicoPocket download workflow`

詳細:

- Move acquisition progress and FFmpeg/save states into NicoPocket
- Suppress legacy save clicks and execute only the validated final M4A link
- Handle save-start timeouts, interrupted/paused downloads and explicit cancellation
- Track owned save targets and cancel stale requests without affecting other downloads
- Release Blob URLs and execution state for repeated downloads without page reloads
- Share metadata mapping between FFmpeg and the expandable preview
- Display the original title and lock editing during downloads
- Preserve audio quality selection, AAC stream copy, metadata and JPEG attached artwork
- Verify repeated saves, interruption/timeout/cancel recovery, AAC equality and playback
- Validate PNG with bundled FFmpeg and retain JPEG pending player compatibility checks
- Review existing thumbnail permissions without expanding them

対象変更: 本書の10ファイル。
検証内容: 上記の合成・Chrome・音声/画像バイト比較・UI・構文・センシティブチェック。
未実装: 本書の未解決事項表。コミット・プッシュは実行しない。

## 参照

- Chrome downloads API: https://developer.chrome.com/docs/extensions/reference/api/downloads
- FFmpeg stream copy / attached picture: https://ffmpeg.org/ffmpeg.html
