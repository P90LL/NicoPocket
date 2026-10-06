# Phase 5: M4Aへ動画Metadataを埋め込み

## 変更ファイル

| ファイル | 変更内容 |
| --- | --- |
| `nico_downloader/pocket/video-info.js` | 既存JSONアクセサーからGenre・Series・登録日時を取得し、軽量contextへ追加。 |
| `nico_downloader/pocket/background.js` | 追加情報を型確認・長さ制限して保持。照合済みcontextのMetadataを実行ジョブと取得元タブへ渡す。 |
| `nico_downloader/pocket/aac-bridge.js` | Metadata、正規化済み編集タイトル、動画IDを既存NicoDownloaderインスタンスへ渡す。 |
| `nico_downloader/dist/utils.js` | 既存M4A用引数へMetadataを追加。空・欠損値を省略し、UTF-8でFFmpegへ渡す。 |
| `PHASE5.md` | マッピング、検証結果、次Phaseの接続位置を記録。 |

## データフローと既存処理の再利用

```text
既存NicovideoClass / watch JSON
 → NicoPocketVideo.readCurrentのcontext
 → backgroundで取得元を照合
 → 編集後タイトルをNicoPocketTitle.normalizeで正規化
 → 実行ジョブ → 取得元タブ → 既存NicoDownloader
 → runFFmpeg_m3u8のm4a用metadata引数
 → 同梱FFmpegでstream copy＋Metadata付きM4A生成
 → 既存Blob / DownloadLinkClick / 保存監視
```

新たな動画取得やタグライブラリは追加していません。既存のJsonToGenre、JsonToSeries、JsonToRegisteredAt、JsonToUserとPhase 2の投稿者フォールバックを利用しています。

旧runFFmpeg_m3u8には独立したMetadata生成関数がなく、FFmpeg引数へ直接設定しています。その既存マッピング（title、artist、episode_id、genre、album、album_artist、date、creation_time）をM4A経路へ適用しました。既存ASCIIメモリAPIへUTF-8バイト列を渡す方式も維持し、TextEncoderで日本語・絵文字のUTF-8バイト列を作ります。旧AAC・MP4経路と引数は変更していません。

## Metadataマッピング

| タグ | 元データ・条件 |
| --- | --- |
| title | UIで編集したタイトルを共通関数で正規化した値。保存名の拡張子を除いた値と同一。 |
| artist | context.uploader。投稿者名が欠損・空の場合は省略。 |
| episode_id | 取得元照合済みのvideoId。既存タグ名を再利用。 |
| comment | context.sourceUrl。動画ページの正規URL。クエリや配信URLは含めない。 |
| genre | 既存JsonToGenreで取得したジャンル。欠損時は省略。 |
| album | 既存JsonToSeriesで取得したシリーズ名。欠損時は省略。 |
| album_artist | シリーズが存在する場合の投稿者名。空・欠損時は省略。 |
| date | 既存JsonToRegisteredAtの値。日時として解釈できる場合のみ設定。 |
| creation_time | dateと同じ日時。MP4コンテナではUTCへ正規化される。 |

文字列以外、空文字、空白だけの値はタグ自体を省略します。NULなどの制御文字は空白へ置き換えます。Uploader・Genre・Seriesはcontextで500文字、日時は100文字に制限しています。編集タイトルは既存の共通正規化を利用します。

Descriptionは任意項目のため今回は省略しています。旧処理には直接代入があるものの、長文・HTML等を扱う処理を追加していません。show、publisher等の追加タグも新設していません。Video URLはdescriptionと混在させずcommentへ保存します。

独自タグやuse_metadata_tagsは追加せず、既存MP4タグを使用します。生成物ではepisode_idとcommentをffprobeで確認できています。プレイヤーがこれらのタグをUIに表示するかは各製品の仕様に依存します。

## FFmpeg引数

```text
ffmpeg -nostdin -allowed_extensions ALL -i master.m3u8
  -map 0:a:0 -vn -c:a copy
  -map_metadata -1 -map_metadata:s:a -1 -map_chapters -1
  -metadata title=編集後タイトル
  -metadata artist=投稿者名
  -metadata episode_id=動画ID
  -metadata comment=正規動画URL
  -metadata genre=ジャンル
  -metadata album=シリーズ名
  -metadata album_artist=投稿者名
  -metadata date=登録日時
  -metadata creation_time=登録日時
  -f mp4 動画ID.m4a
```

任意項目の引数は値がある場合だけ追加します。実装は引数配列で渡すため、値の空白・引用符・等号等をシェル解釈しません。入力の自動タグコピーを止めた上で、明示したMetadataだけを設定します。MIMEはPhase 4のaudio/mp4、保存名は正規化済み編集タイトル.m4aです。

## 実行管理と音声

-c:a copyを維持し、再エンコード・ビットレート変更は行いません。新たなFFmpeg実行環境・2回目の変換・中間ダウンロードはありません。Phase 3/4の二重実行防止、取得元照合、Download無効化、完了・失敗時復帰、保存監視を維持しています。ページ側の既存進捗表示も変更していません。

## 合成データでの検証

一時Chromeプロファイルに実装本体を読み込み、動画ページ・動画JSON・配信応答を合成データで供給して確認しました。

- 同梱FFmpeg/WasmでMetadata付きM4Aを保存。
- ffprobeでtitle、artist、episode_id、comment、genre、album、album_artist、date、creation_timeを確認。
- 日本語・絵文字・アクセント文字を含む編集タイトル、投稿者、シリーズ名が文字化けせず保持されることを確認。
- 禁則文字を含む編集タイトルが正規化され、保存名とmetadata.titleが一致することを確認。
- 投稿日時のタイムゾーンを考慮し、creation_timeが同一時刻を示すことを確認。
- 投稿者・Genre・Series・日時がない動画でも保存成功し、そのタグが省略されることを確認。
- TSとCMAF入力のAACを同じADTS形式へ抽出し、出力のAACバイト列と完全一致。
- Phase 4のMetadataなしM4AとPhase 5のMetadata付きM4AのAACバイト列も完全一致。
- M4A全体のデコードと途中位置からのシーク・デコードが成功。
- 音声1ストリームのみで、Artworkや動画ストリームは含まれないことを確認。
- 成功4回でダウンロード4回のみ。全保存名が.m4a。
- 二重クリック防止、古い動画の拒否、取得中の動画切り替え、新しい動画での保存を確認。
- プレイリスト・FFmpeg失敗からの復帰と再試行、取得元タブ終了時の復帰を確認。
- ユーザーの元の保存形式設定が維持されることを確認。

意図的な失敗テストでは既存エラーログが残ります。UIは操作可能な状態へ戻ります。FFmpeg呼び出しログは既存API向けのUTF-8バイト表現となりますが、保存Metadataは正しいUnicodeとして検査済みです。

## 実サイトで確認する内容

合成データでの検証と区別し、実ニコニコ動画でのPhase 5保存・普段使用するプレイヤーでの表示と再生は未確認です。

1. 拡張機能と動画ページを再読み込みし、動画を再生してNicoPocketを開く。
2. タイトルを編集してM4Aを保存し、保存名とtitleの一致を確認。
3. 投稿者、動画ID、URL、値があるGenre・Series・日時をffprobe等で確認。
4. 普段使用するプレイヤーで全体再生・シーク・日本語タグ表示を確認。
5. 投稿者やシリーズがない動画、別動画への切り替え、失敗・保存キャンセル後の再試行を確認。

旧AAC・MP4経路の実サイト回帰確認、長い動画やプレイヤー別のタグ表示も実機確認対象です。Phase 3からの30分上限等の制約は維持しています。

## Phase 6の画像編集接続候補

Phase 2のcontext.thumbnailUrlとwindow.jsの既存Artwork表示、window.htmlのArtwork編集ボタンが画像編集の入口です。元画像を取り込み、固定1:1クロップ・位置・ズーム・最終画像生成をUIの編集状態へ接続できます。

画像編集の出力はMetadata引数と分離して保持する候補です。Phase 6は画像編集だけを完成させる方針で、今回もM4A画像ストリーム・attached_pic・JPEG生成・画像入力は追加していません。後続の埋め込みPhaseではrunFFmpeg_m3u8の入力・map指定が接続候補ですが、今回の音声専用mapは維持しています。

## 参照

- ユーザーのPhase 5実装指示
- PHASE4.md、既存func/nicojson.js・dist/utils.js・pocketの接続処理
- https://ffmpeg.org/ffmpeg.html
- https://ffmpeg.org/ffmpeg-formats.html
