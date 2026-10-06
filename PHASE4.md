# Phase 4: AAC音声をstream copyでM4A保存

## 変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/dist/utils.js` | 既存runFFmpeg_m3u8にM4A出力経路を追加。既存MIME変換関数へm4a → audio/mp4を追加。 |
| `nico_downloader/pocket/aac-bridge.js` | NicoPocket実行中のみm4aモードを選び、正規化済みタイトル.m4aを保存名に使用。保存リンクの拡張子確認を更新。 |
| `nico_downloader/pocket/background.js` | 保存中断メッセージをM4A表記へ変更。実行管理・保存監視は維持。 |
| `nico_downloader/pocket/window.html` | 拡張子・保存表示を.m4aへ変更。 |
| `nico_downloader/pocket/window.js` | 処理中・保存完了表示をM4A表記へ変更。 |
| `PHASE4.md` | 実装・検証結果と次Phaseの接続位置を記録。 |

## データフローとFFmpeg引数

```text
NicoPocket Download
 → Phase 3の動画URL・動画ID・取得元タブ照合
 → 既存VideoDown / MovieDownload_domand
 → 既存HLS解析・セグメント取得・DownEncoder
 → 既存Transcode / runFFmpeg_m3u8のm4a経路
 → 同梱FFmpegでAAC音声をMP4コンテナへstream copy
 → 既存FFMPEG_ENDコールバック
 → core.FS.readFile / Blob / downloadlink
 → 既存DownloadLinkClick
 → 編集済みタイトル.m4aを保存
```

FFmpeg呼び出しは次の引数です。入力・出力名は仮想FS内の名称です。

```text
ffmpeg -nostdin -allowed_extensions ALL -i master.m3u8
  -map 0:a:0 -vn -c:a copy
  -map_metadata -1 -map_metadata:s:a -1 -map_chapters -1
  -f mp4 動画ID.m4a
```

`-nostdin`は既存ffmpegラッパーが付与します。既存のHLS入力から最初の音声だけを選び、直接M4Aへ格納します。中間AAC出力や2回目のFFmpeg実行は不要です。AACからMP4コンテナに必要なビットストリーム形式の変換はmuxerの既存処理に任せます。

`-c:a copy`により音声のエンコーダーを使用しません。音質・ビットレート・サンプルレートの変更引数はありません。標準音質／高音質の選択は今回も未接続です。

M4A経路には動画タイトル・投稿者などのmetadata引数を渡しません。入力のmetadataとchapterもコピーしません。MP4形式の技術情報（brand、muxer/encoderの識別文字列など）は通常どおり出力されます。旧AAC・MP4経路の既存metadata引数は変更していません。

## 保存名・MIME・一時ファイル

- Phase 2/3のNicoPocketTitle.normalizeを再利用し、編集済みタイトル.m4aを保存名に使用。
- 既存FiletypeToMimetypeへm4aを追加し、BlobのMIMEをaudio/mp4に設定。
- FFmpeg仮想FSに入力プレイリスト・セグメントと最終M4Aを置く既存構造を利用。
- 最終M4Aは既存printコールバックで読み出してBlob化し、仮想FSからunlinkする。
- AAC・JPG・TMPなどの中間ファイルを新規生成・保存しない。
- 入力ファイルやFFmpeg coreのライフサイクルは既存実装を維持。

## Phase 3の実行管理

ジョブIDと内部メッセージ名のnp:aac-*は互換性のため維持しました。名称の全面変更はしていません。

UI・background・取得元タブの二重実行防止、Download無効化、動画ID照合、AbortSignal、終了・失敗時の復帰、Chrome download IDによる保存監視は変更していません。ユーザーの保存形式設定を書き換えず、NicoPocket要求中のみm4aを選びます。

ニコニコ動画ページ側の既存進捗表示は維持しています。HLS取得・CMAF解析、FFmpeg core/Wasm、新たなService Worker構造への移行は今回変更していません。

## 合成データによる検証

リポジトリの拡張機能を一時Chromeプロファイルへ読み込み、動画ページ・動画JSON・配信応答を合成データで供給しました。取得・FFmpeg/Wasm・Blob生成・Chrome保存は実装本体を実行しています。

- MPEG-TSとCMAF/fMP4形式の入力からM4A保存が成功。
- ffprobeでMP4/M4Aコンテナ、音声1ストリーム、AAC-LC、44.1kHz、1chを確認。
- 入力と出力を同じADTS形式へstream copyで抽出し、AACバイト列の完全一致を確認（TSとCMAFの両方）。
- 保存M4A全体をデコードし、デコードエラーがないことを確認。
- Chromeの保存情報でMIMEがaudio/mp4であることを確認。
- 編集済みUnicodeタイトルが正規化され、.m4aの保存名へ反映されることを確認。
- 成功4回に対して保存イベントも4回のみ。保存名はすべて.m4aで、中間ファイルの追加保存なし。
- Title、Artist、Album、Genre、Video IDなどのユーザーmetadataが未挿入であることを確認。
- 二重クリックで1回だけ取得すること、保存完了後にUIが復帰することを確認。
- 古い動画の要求拒否、取得中の動画切り替えによる中断、新しい動画での再実行を確認。
- プレイリスト失敗・FFmpeg失敗からの復帰と再試行、取得元タブ終了時の復帰を確認。
- 元の保存形式設定がMP4のまま維持されることを確認。

意図的に壊した入力のテストでは既存処理の例外ログも発生します。UIはエラー状態から操作可能に復帰します。

## 実サイトで必要な確認

実ニコニコ動画からのPhase 4保存・プレイヤーでの再生は未確認です。合成データの検証と区別してください。

1. 拡張機能と動画ページを再読み込みし、動画を再生してNicoPocketを開く。
2. タイトルを編集し、Downloadを押して対象動画の.m4aだけが保存されることを確認。
3. 保存M4Aを普段使用するプレイヤーで再生し、音声・長さ・シークを確認。
4. 別動画でも同じ操作を行い、表示動画と保存音声が一致することを確認。
5. 連打、保存キャンセル・失敗後の再試行を確認。
6. 実サイトの配信形式、ログイン条件、長い動画での完了を確認。

従来AAC・MP4経路のコードと引数は維持していますが、実サイトでの通常取得の回帰確認は未実施です。Phase 3からの30分上限などの制約も維持しています。

## Phase 5の接続候補

`dist/utils.js`のrunFFmpeg_m3u8内、m4a経路のffmpegArgsが接続箇所です。出力名の前にmetadata引数を追加すれば、同じstream copyでM4A生成とMetadata挿入をまとめられます。今回のmap_metadata=-1は入力タグの自動コピーを止めるもので、明示的なmetadataの設定箇所とは分けられます。

編集済みTitleやUploader等の受け渡しは、Phase 2のcontextからPhase 3の実行要求・ジョブへ接続する候補です。現在は保存用titleとvideoIdを渡しており、その他の情報の受け渡し・タグ名・Unicode処理はPhase 5で実装します。Artworkは未接続です。

## 参照

- ユーザーのPhase 4実装指示
- PHASE3.mdと既存nico_downloaderのFFmpeg・保存処理
- https://ffmpeg.org/ffmpeg.html
- https://ffmpeg.org/ffmpeg-formats.html
