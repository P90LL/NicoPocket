# Phase 8: 音質選択を既存入力ストリームへ接続

## 範囲と変更ファイル

- `nico_downloader/pocket/audio-quality.js`: 既存音声候補の品質IDから明示されたkbpsを読み取り、標準・高音質の候補を選ぶ小さな関数を追加。
- `nico_downloader/manifest.json`: 上記関数を取得ブリッジより前に読み込む。
- `nico_downloader/pocket/window.js`: 選択値をDownload要求へ含め、音質説明の準備中表記を更新。
- `nico_downloader/pocket/background.js`: 要求音質を検証・転送し、選択結果を安全なフィールドだけでセッション状態へ保持。
- `nico_downloader/pocket/aac-bridge.js`: 既存音声URL選択入口をNicoPocket要求時だけ拡張。選択した音声を既存HLS取得・同梱FFmpegへ渡す。
- `PHASE8.md`: 実装・検証・保留事項の記録。

## データフローと既存処理の再利用

`NicoPocketEditor.quality` → Download要求 → backgroundジョブの`requestedQuality` → 既存`VideoDown` → `MovieDownload_domand` → `M3u8ToAudioAndVideoUrlSet` → 選択音声m3u8 → 既存HLS/CMAF/Segment取得 → 同梱FFmpeg → Metadata・Artwork付きM4A保存。

品質記述子はPhase 2の`context.audioQualities`を転送し、取得処理が保持する`NicovideoClass.GetWatchData().media.domand.audios`がある場合は、その最新の取得済み値を優先する。動画情報取得の新規リクエストは追加しない。

音声候補は既存`FirstBody_json["EXT-X-MEDIA"]`の`TYPE=AUDIO`とURIから列挙する。既存`URLToM3u8Set`、`Parsem3u8`、`SetM3u8`、`MovieDownload_domand`、`DownEncoder`を再利用し、取得ロジックを複製しない。

## 選択ルールと仮定

| 利用可能な明示品質 | 標準 | 高音質 |
| --- | --- | --- |
| 128 | 128 | 128 |
| 128 / 192 | 192 | 192 |
| 128 / 192 / 256 | 192 | 256 |
| 256 | 256 | 256 |
| 判定不能 | 従来の既定取得 | 従来の既定取得 |

標準は192 kbps以下の最大値。該当候補がない場合は既存候補の最大値をそのまま使用する。高音質は最大値。同値ではmaster中の先頭候補を尊重する。初期値・別動画への切り替えは標準のまま。

`audio-aac-192kbps`のようにkbpsが明示された品質IDを使用する。watch JSONのIDとの対応はrenditionのNAME/IDまたはURIのパス中のIDで照合する。watch品質一覧がない場合も、master自身に明示されたIDは利用できる。明示的に利用不可の対応候補は除外する。

数値のみのbitrateは単位が確認できないため推測しない。映像を含む`EXT-X-STREAM-INF:BANDWIDTH`を音声bitrateとして扱わない。URIのクエリから品質を推測しない。残る候補に判定不能・曖昧な品質が含まれる場合は、最高品質を断定せず従来選択へ戻す。

masterの選択音声行・GROUP-IDを特定できる場合だけ変更を適用する。音声EXT-X-MEDIAを選択行へ絞り、映像variantのAUDIO参照を選択グループへ合わせる。これによりFFmpegの既存`-map 0:a:0`も同じ入力を選ぶ。音声URLだけを変更してmasterを古いまま渡さない。選択行やグループを確認できない場合は元のmasterとURLを維持する。

## 選択結果と既存機能の維持

`np:aacJob.audioSelection`に`requestedQuality`、`selectedAudioId`、`selectedBitrate`（kbps）、`fallback`を保存する。判定不能時のID・bitrateはnull。署名付き音声URLやwatch JSON全体は保存しない。結果イベントは従来と同じジョブID・タブ・フレーム照合を通す。

FFmpeg引数組み立て、`-c:a copy`、JPEGの`-c:v copy`と`attached_pic`、Metadata、正規化済み保存名、Blobの`audio/mp4`は変更していない。HLS/CMAF/Segment本体、保存監視、二重実行防止、動画切り替え中断、エラー復帰も維持する。NicoPocket以外の要求では元の選択関数をそのまま実行する。

## 合成データによる検証

実際の拡張機能・既存HLS取得・同梱ffmpeg.wasmを使用し、配信応答だけを合成データへ置換した。

- 上表5ケース×2音質、計10回のM4A保存に成功。取得された音声m3u8と内部選択記録が期待値と一致。
- 品質値は合成masterの品質IDに明示した公称値。入力は各品質で異なる音声を使用し、選択後の音声データも確認。
- 各出力から取り出したAACと選択元AACを同じADTS形式で比較し、バイト単位で一致。音声の再エンコードなし。
- ffprobeでtitle、artist、episode_id、commentの動画URL、genre、albumを確認。保存名とtitle一致。
- 768×768 JPEGのattached pictureを確認。各M4Aの全体デコードと途中シークに成功。
- 各処理後、仮想FSにArtwork一時ファイル・M4Aの残留なし。保存されたのは最終M4Aのみ。
- 別動画への切り替えで標準音質へ戻ることを確認。
- 既存Phase 7の合成テストも再実行。二重クリック防止、Artwork欠損フォールバック、Metadata欠損、JPEG維持、CMAF、プレイリスト失敗、FFmpeg失敗後の再試行、動画切り替え中断と次動画保存、タブ閉鎖時の復帰を確認。
- 選択関数の境界検証: 利用不可候補の除外、URIパスの品質ID、クエリ文字列を無視、未知候補・不正URIのフォールバック。

失敗テストでは意図的に不正応答を与え、既存ログにエラーが出ることを確認した。実サイトでの保存、実配信品質一覧、実プレイヤー表示はこの検証には含まれない。

## 実サイトで確認すること

- 実際のwatch JSON・masterで品質IDと音声URIが対応しているか。判定できない形式はfallbackになる。
- 標準・高音質で配信候補に応じた入力が選ばれ、`audioSelection`に正しい結果が残るか。
- 編集名、Metadata、Artworkを保持したM4Aを保存し、対応プレイヤーで再生・シークできるか。
- 別動画への切り替え時の標準復帰と取得中断、エラー時のUI復帰。

## センシティブ情報チェック

今回変更した全ファイルを対象に、ローカル絶対パス、ユーザー名、キー、Token、Cookie、Authorization、個人識別情報、環境固有値、一時URL、セッション値、署名付きURLを確認。資格情報を新規追加していない。テスト用URL・データ・ログはプロジェクトへ追加しない。

センシティブ情報の混入なし。

## 保留事項とPhase 9の接続箇所

- 埋め込みMetadata一覧表示: `window.js`のcontextと既存Metadataマッピング。
- 元動画タイトルをArtwork欄付近へ表示: `context.originalTitle`とwindow UI。
- DL進捗をNicoPocketへ移す: 既存取得進捗、aacイベント、backgroundジョブ、window状態表示。
- ChromeのDownload許可待ち・中断時の再試行: backgroundのdownloads監視とbridgeのsave。
- Chrome許可後に旧AAC保存経路が再開する問題: 元の保存リンクとDownloadLinkClickの導線。
- 同一動画のページリロードなし再DL: 既存実行ロック・保存リンク・取得状態。
- ArtworkをPNGへ変更可能か検証: Artwork生成・Blob転送検証・仮想FS入力・コンテナ互換性。
- Artwork画像ホスト権限の最終見直し: manifestと画像取得。
- 最終UI微調整: window.html/css/js。

上記は今回未実装。コミット・プッシュは実行しない。

## 推奨コミットメッセージ

件名: `feat: connect audio quality selection`

詳細:

- Connect standard/high UI selection to existing audio rendition acquisition
- Select the highest available stream at or below 192 kbps for standard quality
- Use the highest existing stream when only higher bitrates are available, without re-encoding
- Select the highest bitrate for high quality and retain upstream fallback for unknown quality
- Keep the selected rendition consistent in the HLS master and record safe selection details
- Preserve AAC stream copy, metadata, JPEG attached artwork, filenames and execution guards
- Verify five quality cases with bundled FFmpeg, exact AAC comparison, decode and seek
- Verify fallback, source switching, error recovery, retry and temporary file cleanup
- Defer progress UI, download permission handling, repeated downloads, metadata UI and PNG artwork

## 参照

- HLSの音声rendition・AUDIOグループ: https://www.rfc-editor.org/rfc/rfc8216.html
- FFmpegのstream selection・stream copy: https://ffmpeg.org/ffmpeg.html
