# NicoPocket

ニコニコ動画のAAC音源を、編集したタイトル・Metadata・Artwork付きのM4Aとして保存する個人用途のChrome拡張機能です。

**個人利用・ローカルインストール専用です。Chrome Web Storeでの公開予定はありません。**

## About

[masteralice3104/nico_downloader](https://github.com/masteralice3104/nico_downloader)の動画情報・HLS/CMAF取得と同梱FFmpegを基礎にしています。音声は再エンコードせず、既存AACをM4Aコンテナへ格納します。

```text
動画ページ → NicoPocket編集 → Download
→ 既存音声取得 → AAC stream copy
→ Metadata・Artwork付きM4A → 編集タイトル.m4a
```

## Features / Initial Scope

- [x] 独立したNicoPocket編集ウィンドウ
- [x] 動画情報・元タイトル・投稿者・サムネイルの取得
- [x] タイトル編集・禁則文字の正規化
- [x] 1:1固定Artworkクロップ・ドラッグ・ズーム・リセット
- [x] 標準音質 / 高音質の入力ストリーム選択
- [x] AAC取得と再エンコードなしのM4A remux
- [x] Metadata・JPEG Artwork埋め込み
- [x] Metadataの保存前プレビュー
- [x] 取得進捗・生成・保存・完了・エラー表示
- [x] キャンセル・中断後の再試行・同一動画の連続保存
- [x] NicoPocketの名称・アイコン・使い方案内

複数サイト、一括・並列Download、キュー、MP3、AIクロップは対象外です。

### Title Edit

元動画タイトルを初期値として編集できます。禁則文字・空白・末尾の点等を共通関数で正規化し、空のタイトルは動画IDへ戻します。

保存名の拡張子を除いたタイトルと、M4Aの`metadata.title`は同じ値です。保存先に同名ファイルが存在するとChromeが連番を付ける場合があります。元タイトルは編集不可の参照欄に表示します。

### Artwork

固定正方形の枠に対して元画像を中央配置し、余白が出ない倍率からドラッグ・ズームで調整します。適用結果は**768×768 JPEG、品質0.9**です。JPEGを再変換せずattached pictureとして埋め込みます。

未編集時もサムネイルから中央クロップした768×768 JPEGを自動生成して埋め込みます。画像欠損・取得・生成失敗時のみArtworkなしで保存を継続します。同じ動画の編集状態はウィンドウ内で保持し、別動画で初期化します。ウィンドウを閉じた後の永続保存は行いません。

PNGも同梱FFmpegで格納・音声コピー・Metadata・画像バイト一致を検証済みですが、ネイティブプレイヤー比較が未確認のためJPEGを維持しています。

### Audio

FFmpegの`-c:a copy`を使用します。ビットレートを上げる処理や192 kbpsへの強制再エンコードは行いません。最終保存はM4A、Blob MIME typeは`audio/mp4`です。AACやJPEGの中間ファイルは保存しません。

### Audio Quality

初期値・別動画への切り替え時は標準音質です。

| 利用可能な候補 | 標準音質 | 高音質 |
| --- | --- | --- |
| 128 kbps | 128 | 128 |
| 128 / 192 | 192 | 192 |
| 128 / 192 / 256 | 192 | 256 |
| 256のみ | 256 | 256 |
| 品質不明 | 既存の既定取得 | 既存の既定取得 |

標準は192 kbps以下の最高品質、該当候補がない場合は既存候補の最高品質をそのまま使用します。高音質は最高bitrateです。品質IDに明示されたkbpsを利用し、不明な値は推測しません。

### Metadata

UIとFFmpegが同じ生成関数を使用します。取得できた項目だけを設定します。

| 表示 | M4Aタグ / 入力 |
| --- | --- |
| Title | 編集・正規化済み`title` |
| Artist | 投稿者`artist` |
| Video ID | `episode_id` |
| Video URL | `comment` |
| Genre | `genre` |
| Series / Album | `album`、取得できる場合の`album_artist` |
| Date | 有効な投稿日時の`date` / `creation_time` |
| Artwork | 中央クロップまたは編集済みJPEGのattached picture |

日時はコンテナ内でUTC表記になる場合があります。Descriptionはこの版では追加していません。

### UI

UIはダークテーマ固定です。元ページの「NicoPocketで保存」から独立ウィンドウを開きます。タイトル・Artwork・音質を編集し、開閉式のMetadata欄で確認してDownloadを実行します。大きな音声取得はDownload押下後に開始します。

## Usage

1. Chromeで`chrome://extensions/`を開き、デベロッパーモードを有効にします。
2. 「パッケージ化されていない拡張機能を読み込む」で、このリポジトリの **`nico_downloader/`** を選択します。
3. ニコニコ動画の動画ページを開き、動画を再生します。
4. 「NicoPocketで保存」を押します。
5. 保存タイトル、Artwork、音質、Metadataを確認します。中央クロップを変更する場合はArtworkを編集して適用します。
6. Downloadを押します。Chromeの許可・保存先確認が表示された場合は、Chrome側で操作してください。
7. 中断・エラー後は再試行できます。待機中はキャンセルで解除できます。

拡張機能更新時は拡張機能を再読み込みし、開いている動画ページも再読み込みしてください。ツールバーのNicoPocketアイコンと「拡張機能のオプション」から使い方を確認できます。

保存形式・保存名の旧設定は表示しません。必要な既存取得設定は内部で維持し、新規利用時に必要な既定値を補います。

## Development Status

個人利用版の表示バージョンは**1.0.0**です。Chrome内部の`version`は、フォーク元の5.0.0.21から進めた**5.0.0.23**です。

**NicoPocket 1.0.0 個人利用版 完成。** Phase 1〜10とFIX1〜FIX6の整理を完了しました。ユーザーによる実サイト確認で、M4A保存、Metadata、Artwork、音質選択、同一動画の連続保存、再試行、Artwork編集とダークUIの動作を確認済みです。

追加AACと不要なプレーヤー設定表示は別拡張機能「ニコニコ保存」との競合でした。その拡張機能の無効化で解消しています。NicoPocket側では同種拡張との共存対応を行いません。

合成検証と実サイト確認は別の証拠として扱います。完成監査の範囲・結果・未確認項目は[FINAL_AUDIT.md](FINAL_AUDIT.md)、発行元診断と撤去結果は[PHASE10_FIX6.md](docs/development/PHASE10_FIX6.md)を参照してください。過去のPHASE / FIX記録は当時の状態を残しており、古い保存形式・UI・保留事項は現在の仕様を意味しません。

## Known Limitations

- Chromeの許可UIや保存先ダイアログは自動承認しません。Chrome側で確認してください。
- APIで保存先ダイアログを直接識別できない場合があります。保存待ち・保存中表示は取得できる状態に基づきます。待機中はキャンセルできます。
- 保存開始を60秒確認できない場合はタイムアウトします。Download ID取得後は完了・中断監視を利用し、編集画面が開いている間は5秒ごとに自分の保存を確認します。保存量が10分変化しない場合はタイムアウトします。取得処理全体には既存の30分上限もあります。
- 同種のニコニコ保存系拡張機能との同時利用は非推奨で、共存時の挙動は保証しません。無関係な保存要求を自動キャンセルしません。
- NicoPocketが所有する要求はジョブID・Blob URLで照合します。無関係なDownloadは変更しません。
- 長時間・大容量の動画はブラウザメモリや同梱FFmpegの制約を受けます。
- ニコニコ側の配信仕様、DOM、音質ID、画像ホストが変わると取得できなくなる場合があります。
- PNGの一般的なプレイヤー比較は未確認です。JPEGを維持しています。
- 編集画面を閉じるとArtwork編集状態は失われます。保存状態の確認・キャンセルには編集画面を使用してください。

## Troubleshooting

- **AACも保存される・プレーヤー設定が勝手に開く:** 同種の保存拡張機能を無効化し、動画タブを閉じて新しいタブで確認してください。実サイトでは別拡張「ニコニコ保存」の無効化で解消しました。
- **保存が進まない:** ChromeのDownload許可・保存先ダイアログを確認してください。待機をキャンセルした後に再試行できます。許可UIは自動操作しません。
- **更新が反映されない:** 拡張機能を再読み込みし、動画ページも再読み込みしてください。
- **動画・Artworkを取得できない:** 動画を再生して再試行してください。画像取得失敗時はArtworkなしで保存します。ニコニコ側仕様変更や実サイト固有の状態によって取得できない場合があります。

## Notes

個人用途の非公式ツールです。ニコニコ動画・ドワンゴ等の公式プロジェクトではありません。外部への診断ログ送信、解析、ストア配布は実装していません。

## Permissions

- `storage`: 設定、取得元情報、ジョブ・保存監視の状態を保持。
- `downloads`: 自分の保存の監視・照合・キャンセル。
- 画像取得ホスト: `nicovideo.cdn.nimg.jp`、既存画像の`tn.smilevideo.jp`。
- 動画ページ上のcontent script: `www.nicovideo.jp`。

`tabs`、`scripting`、全URLのhost permissionは要求しません。ニコニコ大百科用の旧content scriptは読み込み対象から外しました。

## Credits

- 基礎取得処理: [masteralice3104/nico_downloader](https://github.com/masteralice3104/nico_downloader)
- 音声処理: [FFmpeg](https://ffmpeg.org/) / 同梱ffmpeg.wasm
- 既存FFmpeg連携が参照する実装: [naari3/nico-downloader-ffmpeg](https://github.com/naari3/nico-downloader-ffmpeg)

元プロジェクトの著作権表示と同梱資産を保持しています。NicoPocketのアイコンは既存のUIロゴから生成しています。

## License

プロジェクトのMIT License本文と`Copyright (c) 2021 masteralice3104`を[LICENSE](LICENSE)および`nico_downloader/LICENSE`に保持しています。追加コードも同じMIT Licenseとして扱います。

同梱FFmpeg等の第三者資産には、それぞれのライセンスが適用されます。プロジェクトのMIT Licenseだけで第三者資産のライセンスを置き換えるものではありません。同梱バイナリには`--enable-gpl`・`--enable-nonfree`・`libfdk-aac`の構成が含まれます。第三者バイナリをMITのみとして扱わず、個人利用の既存基盤として維持します。確認結果は[PHASE10.md](docs/development/PHASE10.md)に記録しています。
