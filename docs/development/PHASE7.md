# Phase 7: Metadata付きM4AへArtworkを埋め込み

## 変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/pocket/window.js` | Phase 6のArtwork BlobをJPEGバイト配列にし、取得元の識別情報と共にDownload要求へ追加。 |
| `nico_downloader/pocket/background.js` | 動画・タブ・URL・サムネイルを照合し、JPEGの形式・サイズを検査して取得元タブへ転送。画像バイトはsession storageへ保存しない。 |
| `nico_downloader/pocket/aac-bridge.js` | 同梱FFmpeg coreの仮想FSへJPEGを書き込み、成功・失敗・中断時に一時ファイルを削除。不正画像は画像なしへフォールバック。 |
| `nico_downloader/dist/utils.js` | M4A経路へJPEG入力・画像map・stream copy・attached_picを追加。 |
| `nico_downloader/pocket/artwork.js` | 保存時のArtwork埋め込みと未編集時の扱いを案内する文言へ更新。編集・JPEG生成処理は変更しない。 |
| `PHASE7.md` | データフロー、検証結果、保留事項、Phase 8の接続位置を記録。 |

## データフローと入力

```text
NicoPocketEditor.artwork.blob（Phase 6の最終JPEG）
 → Blob.arrayBuffer → Uint8Array → JSON用の整数配列
 → backgroundで取得元とJPEGバイトを検査
 → 取得元タブの単一実行ジョブへ渡す
 → 同梱createFFmpegCore
 → JPEGのデコード可否・768×768を確認
 → core.FS.writeFile('np-artwork.jpg', bytes)
 → 既存HLS音声入力＋JPEG入力
 → 音声copy＋画像copy＋Metadata＋attached_pic
 → 既存FFMPEG_END / Blob / DownloadLinkClick
 → 正規化済み編集タイトル.m4a（audio/mp4）
```

Chrome拡張の既存メッセージ経路はJSONで渡すため、BlobやUint8Arrayをそのままメッセージへ入れず、バイトの整数配列にします。Artworkは実行要求のスナップショットであり、バイトやBlob URLをsession storageに永続保持しません。

動画ID、取得元タブID、正規動画URL、サムネイルURLを照合し、Blob読み出し中に状態が変わった画像を採用しません。backgroundでも再照合します。JPEGは最大2MiB、先頭・末尾のJPEGマーカーと0〜255の整数バイトを検査します。取得側は実際にデコードして768×768を確認してから仮想FSへ書きます。元サムネイルURLをFFmpegへ直接渡す経路はありません。

## FFmpeg引数と画像形式

Artworkがある場合:

```text
ffmpeg -nostdin -allowed_extensions ALL -i master.m3u8
  -i np-artwork.jpg
  -map 0:a:0 -c:a copy
  -map 1:v:0 -c:v copy -disposition:v:0 attached_pic
  -map_metadata -1 -map_metadata:s:a -1 -map_chapters -1
  [Phase 5の-metadata引数]
  -f mp4 動画ID.m4a
```

Artworkがない場合は画像入力・map・dispositionを省略し、従来の-vnで音声＋Metadataのみを保存します。

Phase 6のJPEGをそのまま使用します。JPEGはFFmpeg上ではmjpeg codecとして認識されますが、-c:v copyを使うため再エンコードしません。-c:a copyも維持します。生成物にはAAC音声とattached_pic=1の768×768 JPEGが含まれます。

title、artist、episode_id、comment、genre、album、album_artist、date、creation_timeの生成・欠損値省略処理はPhase 5のままです。保存名とmetadata.titleは同じ共通タイトル正規化結果を使います。MIMEはaudio/mp4です。

## Artworkなし・不正画像のフォールバック

未編集時や元画像へ戻した後はPhase 6のblobがnullなので、画像なしで保存します。元画像の初期クロップJPEGを自動生成する処理は追加していません。編集画面にこの扱いを表示します。

画像欠損、サイズ上限超過、取得元不一致、バイト読み出し失敗、JPEG検査・デコード失敗、768×768以外、仮想FSへの画像書き込み失敗は、画像なしのM4A生成へ切り替えます。音声取得やMetadataは続行します。取得元動画自体が変わった場合は従来どおりジョブを中断します。

音声・FFmpeg・保存そのものの失敗は従来のエラー復帰を利用します。FFmpeg muxerの失敗後に画像なしで変換を自動再実行する仕組みは追加していません。今回のフォールバックは欠損・不正Artworkの除外です。

## 一時ファイルと混入防止

JPEGは実行ごとのFFmpeg coreの仮想FSへ書きます。前回の画像をstorageや共有画像キャッシュから再利用しません。NicoPocket要求以外の従来経路は維持しています。

- 通常終了: 既存printがM4Aを読み出しBlob化・unlinkし、main呼び出し終了後のfinallyでJPEGと残った出力を削除。
- FFmpeg失敗: mainのfinallyでJPEGと部分M4Aを削除。
- 動画切り替え・中断・開始失敗: ジョブ終了処理でJPEG・M4Aを削除。
- 同期FFmpeg mainの実行中は即時削除を避け、mainのfinallyへ後始末を任せる。
- 画像が書かれなかった場合や既に削除済みの場合は削除要求を許容する。

入力HLSプレイリスト・音声セグメントのライフサイクルは既存実装のままです。今回確認した後始末は追加JPEGと出力M4Aです。JPEG、AAC、TMPをユーザーへ追加ダウンロードしません。

連続処理の検証で、中断済みジョブの遅延エラーが新しいジョブへ誤って適用されるケースを確認しました。取得元guardのエラーへジョブIDを付け、旧ジョブのエラーで現在のジョブを停止しないようにしました。ログは残し、一般的な同一動画連続DL・Download許可待ちの改善は今回行っていません。

## 合成データによる確認

一時Chromeで拡張機能の本体を読み込み、画像・動画JSON・配信応答だけを合成データへ置き換えました。HLS取得、同梱FFmpeg/Wasm、仮想FS、Blob、Chrome保存は本体を実行しています。

- ffprobeでAAC音声＋mjpeg画像、768×768、attached_pic=1を確認。
- M4Aから抽出したJPEGがPhase 6の最終Blobとバイト単位で完全一致。
- 入力音声と出力M4A、以前のArtworkなしM4AのAACを同一ADTS形式で抽出し、バイト単位で一致。
- 保存名とtitle一致、日本語・絵文字、全9項目のMetadata保持を確認。
- M4A全体のデコードと途中位置からのシークを確認。
- 未編集Artworkで音声＋MetadataのみのM4A保存が成功。
- 不正JPEGで画像なしフォールバック保存が成功。
- 別動画で異なるJPEGを編集し、そのJPEGが埋め込まれて前回画像が混入しないことを確認。
- FFmpeg失敗後、操作復帰とArtwork付きM4Aの再試行成功を確認。
- 各テスト用coreのFSを直接検査し、成功・FFmpeg失敗後にnp-artwork.jpgと.m4aが残らないことを確認。
- 動画切り替え後の保存と旧ジョブの遅延エラーの分離を確認。
- 5回の成功保存に対しダウンロードも5件のみ、すべて.m4a。中間画像の保存なし。
- 二重クリック防止、取得元照合、画像編集状態、画像取得失敗の復帰、元の保存形式設定を維持。
- TSとCMAFの既存音声取得経路で保存成功。

意図的な失敗テストでは既存エラーログが残ります。合成データの検証を実サイト・実プレイヤーの確認と区別してください。

## 実機確認が必要な内容

実ニコニコ動画からのPhase 7保存、対応プレイヤーでのArtwork表示は未確認です。

1. 拡張機能と動画ページを再読み込みし、再生してNicoPocketを開く。
2. Artworkを編集・適用してM4Aを保存する。
3. 対応プレイヤーでArtwork表示、再生・シーク、Metadata・編集タイトルを確認する。
4. 未編集・画像取得失敗時にArtworkなしで保存できることを確認する。
5. 別動画へ切り替え、別Artworkの保存と前回画像の混入がないことを確認する。
6. 失敗後のUI復帰・再試行、長い動画を確認する。

実プレイヤーの表示互換性、旧AAC・MP4の実サイト回帰確認、Phase 3からの30分上限等の制約は実機確認対象です。

## センシティブ情報検査

変更6ファイル（新規PHASE7.mdを含む）を対象に、ローカル絶対パス・ユーザー名・APIキー・Token・Cookie・Authorization・個人識別情報・環境固有情報・一時URL・実セッション値・署名付きURL・その他資格情報を検査しました。センシティブ情報の混入なし。実行時の変数・ジョブIDのプロパティ名は資格情報の固定値ではありません。合成テストのログ・画像・一時URLはリポジトリへ追加しません。

## 保留事項

- NicoPocket UI上に埋め込みMetadata一覧を表示する。
- 元の動画タイトルをArtwork欄付近に表示する。
- DL進捗表示をnico_downloader側からNicoPocket UIへ移す。
- Chrome側のDownload許可待ち・中断時の再試行対応。
- 同一動画をページリロードなしで再DLできるよう改善する。
- 標準音質 / 高音質の実処理接続。
- Artwork用画像ホスト権限の最終見直し。

今回これらを実装していません。

## Phase 8の接続位置

window.jsのNicoPocketEditor.qualityとPhase 2のcontext.audioQualitiesが入口です。Download要求・backgroundの実行ジョブ・取得元タブへ選択値を渡し、既存MovieDownload_domandの音声選択とrunFFmpeg_m3u8の音声出力引数へ接続する候補です。

実際に取得する音声の品質・ビットレートを確認した上で、標準は192kbps基準（元が低い場合はcopy、高い場合の処理はPhase 8で実装）、高音質は取得可能な元音源をcopyする方針です。Metadata・画像map・attached_pic・JPEG copyは維持できます。今回の音声は常に-c:a copyで、品質分岐や再エンコードは追加していません。

## 参照

- ユーザーのPhase 7実装指示
- PHASE5.md、PHASE6.md、既存pocket・dist/utils.jsの取得・保存処理
- https://ffmpeg.org/ffmpeg.html
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
