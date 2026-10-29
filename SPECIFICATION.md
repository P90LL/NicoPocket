# NicoPocket 現行仕様

この文書は、現在のNicoPocketが扱う入出力と動作条件をまとめます。画面操作は[利用ガイド](USER_GUIDE.md)、導入の概要は[README](README.md)を参照してください。Phase・FIX文書と[Phase 10完成監査](docs/development/FINAL_AUDIT.md)は各作業時点の記録です。後続の変更と矛盾する場合は、本書と現在の実装を照合してください。

## 対象と構成

対象はニコニコ動画の動画ページで、出力はメタデータと利用可能なJPEGアートワークを含むM4Aです。Chromeに読み込む拡張機能のルートは`nico_downloader/`です。個人利用・ローカルインストールを対象とし、複数サイト、一括・並列ダウンロード、キュー、MP3出力、AIによるアートワーク切り抜きは対象外です。

動画ページの「NicoPocketで保存」は独立した編集ウィンドウを開きます。動画情報は既存の`nico_downloader`処理から取得し、大きな音声データの取得は編集ウィンドウのDownload押下後に開始します。要求元のタブと動画IDを照合して、既存の`VideoDown → MovieDownload_domand → DownEncoder`へ接続します。最終保存は編集ウィンドウ内の`pocket/save.js`が担当します。

## タイトルと出力ファイル

- 保存タイトルは元動画タイトルから初期化します。禁則文字・制御文字を置き換え、Unicode NFC、空白、末尾の点・空白、Windows予約名を正規化し、180コードポイント以内にします。空の場合は動画IDへ戻します。
- 正規化後のタイトルをM4Aの`title`タグと保存ファイル名の拡張子前に使用します。同名ファイルがあれば、Chromeが実際の保存名に連番を付ける場合があります。
- 最終出力は`編集タイトル.m4a`、Blob MIME typeは`audio/mp4`です。AACやJPEGを独立したユーザーファイルとして保存しません。
- 最終保存ではジョブID、ファイル名、MIME type、M4Aのヘッダーを照合します。無関係なDownloadは自動キャンセルしません。

## 音質と音声処理

初期選択は標準音質です。別の動画へ切り替えると標準音質へ戻ります。品質IDに明示されたkbpsを使い、品質が判別できない場合はビットレートを推測せず既存の既定取得へ戻します。プレイリストの`BANDWIDTH`から音声品質を推測しません。

| 利用可能な品質 | 標準音質 | 高音質 |
| --- | --- | --- |
| 128 kbps | 128 kbpsをコピー | 128 kbpsをコピー |
| 128 / 192 kbps | 192 kbpsをコピー | 192 kbpsをコピー |
| 128 / 192 / 256 kbps | 192 kbpsをコピー | 256 kbpsをコピー |
| 256 kbpsのみ | 256 kbpsを取得し、192 kbpsを目標に再エンコード | 256 kbpsをコピー |
| 品質不明 | 既存の既定取得と音声コピー | 既存の既定取得と音声コピー |

標準音質は、判別できる候補のうち192 kbps以下の最高品質を優先します。該当候補がなく192 kbps超を選択した場合だけ、`-c:a aac -b:a 192k -profile:a aac_low`でAAC-LCへ再エンコードします。それ以外は`-c:a copy`です。192 kbpsはエンコード目標値で、完成ファイルの実測平均値との一致は保証しません。

## アートワーク

動画サムネイルを自動取得する方法と、JPEG・PNG・WebPのローカル画像（10 MiB以下）を指定する方法を選べます。選択画像を正方形に中央切り抜きし、未編集でも **768×768ピクセル、品質0.9のJPEG** を作ります。編集画面ではドラッグ、ズーム、リセット、適用ができます。JPEGは再エンコードせずattached pictureとしてM4Aに埋め込みます。ローカル画像は編集ウィンドウ内だけで扱い、ディスクや拡張機能ストレージへ保存しません。画像の取得・生成に失敗した場合は、アートワークを省略して音声保存を継続します。

同じ動画の編集状態はウィンドウ内で保持し、別動画・別タブへの切り替えやウィンドウの終了で初期化します。PNGの格納は合成環境で確認済みですが、一般的なネイティブプレイヤーでの比較が未確認のため、出力はJPEGを維持しています。

## メタデータ

保存前プレビューとFFmpeg出力は共通の`NicoPocketMetadata.build`を使用し、取得できた値のみを設定します。

| 項目 | M4Aへの値と編集可否 |
| --- | --- |
| Title | 正規化済み保存タイトル。タイトル欄で編集 |
| Artist | 投稿者から初期化。保存前に編集可能 |
| Video ID | `episode_id`。読み取り専用 |
| Video URL | `comment`。読み取り専用 |
| Tags | 動画タグを`, `で連結した`keywords`。自動取得・編集不可 |
| Genre | `genre`。保存前に編集可能 |
| Series / Album | `album`。保存前に編集可能 |
| Album Artist | シリーズを取得した場合は投稿者で初期化。保存前に編集可能 |
| Date | 有効な投稿日時を`date`と`creation_time`へ設定。読み取り専用 |
| Artwork | JPEGのattached picture |

Artist、Album Artist、Series / Albumの編集値は1行に1項目とし、空行を除いて`, `区切りへ正規化します。名前内の空白やカンマを自動的に分割しません。編集可能な項目を空欄で適用すると、そのタグを省略します。「適用」は保存値へ反映し、「キャンセル」は下書きを破棄します。「自動取得値に戻す」は現在動画の初期値を下書きへ戻します。Descriptionはこの版には含めません。

## プリセットとJSONバックアップ

Artist、Album Artist、Genre、Series / Albumのプリセットは入力補助です。候補の選択は編集画面の下書きへ反映され、メタデータ編集画面の「適用」で保存値になります。ArtistとAlbum Artistでは35件の同梱キャラクター候補を共有します。同梱候補の編集・削除状態はユーザー設定側に保持し、同梱JSON本体は変更しません。

Genreの保存値は一つの文字列です。固定IDを持つ標準ジャンル8種類は表示のON／OFFを設定でき、標準項目自体は編集・削除できません。追加ジャンルは登録順で管理し、標準ジャンル名と同一の名前は登録できません。元動画のGenreが有効な候補にない場合はカスタム値として保持します。

ユーザー設定は`chrome.storage.local`の`metadataPresets`に保存します。書き出すJSONはversion 2で、基本形は次のとおりです。`excludedArtists`は同梱Artist候補をグループごとに除外した場合などに追加されます。

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

読み込みは形式を検証し、確認後に全項目を置き換えます。マージしません。キャンセルや不正な形式では既存設定を維持します。旧storage形式とversion 1のJSONは標準Genre名をIDへ、その他を追加ジャンルへ移行します。旧設定にない標準ジャンルを勝手に有効化しません。1項目は4000文字以内の1行、各一覧は1000件以内、読み込むJSONは1 MB以内です。

## UIと保存状態

UIはダークテーマ固定です。アートワークやメタデータのモーダルを開いている間は背面操作とDownloadを遮断します。キャンセル、中断後の再試行、同じ動画の連続保存に対応します。

保存開始を60秒確認できない場合、保存量が10分変化しない場合、取得処理全体が30分を超えた場合には、それぞれ監視上限に達します。保存先ダイアログそのものはAPIから確定識別できず、画面の表示はChromeから取得できる状態に基づきます。Chromeの許可・保存先選択は利用者が操作します。

## 権限と制限

Manifest V3の`storage`は設定・ジョブ状態に、`downloads`は自身の保存の監視・照合・キャンセルに使用します。画像取得ホストは`nicovideo.cdn.nimg.jp`と`tn.smilevideo.jp`、content scriptの対象は`www.nicovideo.jp`です。`tabs`、`scripting`、全URLのhost permissionは要求しません。

ニコニコ動画側の配信方式やDOM、音質ID、画像ホストの変更、長時間動画のブラウザメモリ制約は取得・保存へ影響します。同種の保存拡張機能との共存は保証しません。

## 確認範囲

[Phase 10完成監査](docs/development/FINAL_AUDIT.md)には、ユーザーによる基本的なM4A保存、メタデータ、アートワーク、音質選択、同一動画の連続保存、再試行などの実サイト確認が記録されています。Phase 11のメタデータ編集・プリセット・Genre・標準音質の192 kbps超再エンコード、および後続のupstream同期には合成環境での検証記録がありますが、各文書が示す今回の実サイト操作は未確認です。コードと文書の照合は、実サイトでの動作確認を意味しません。

後続変更の根拠は、[音質](docs/development/PHASE11_AUDIO_192K.md)、[メタデータ編集](docs/development/PHASE11_METADATA_EDIT.md)、[プリセット](docs/development/PHASE11_METADATA_PRESETS.md)、[選択画面](docs/development/PHASE11_PRESET_PICKER.md)、[同梱Artist候補](docs/development/PHASE11_METADATA_CHARACTER_PRESETS.md)、[Genre](docs/development/PHASE11_METADATA_GENRE.md)、[upstream同期](docs/development/UPSTREAM_SYNC_20261008.md)の各記録を参照してください。
