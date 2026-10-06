# NicoPocket

`nico_downloader` を基礎に、ニコニコ動画のAAC音源を  
**アートワーク・メタデータ付きM4Aとして保存するための個人用途Chrome拡張機能**です。

> [!NOTE]
> NicoPocket は現在開発中です。  
> 仕様・UI・内部実装は今後変更される可能性があります。

---

## About

NicoPocket は、現在ローカル環境で行っている以下の処理をChrome拡張機能内へ一元化することを目的としています。

- 動画サムネイルを取得
- アートワーク用にサムネイルをトリミング
- AAC音源をM4Aコンテナへ格納
- M4Aへアートワークを設定
- 動画情報をメタデータとして埋め込み
- 編集したタイトルでファイルを保存

動画・音源の取得部分については、既存Chrome拡張機能  
[`masteralice3104/nico_downloader`](https://github.com/masteralice3104/nico_downloader)  
の実装を基礎として利用します。

NicoPocketでは、`nico_downloader` の取得処理を可能な限り維持しながら、  
**最終ダウンロードの前にNicoPocket独自の編集・変換処理を挟む**構成を目指します。

---

## Concept

```text
NicoNico
   │
   ▼
nico_downloader
   │
   │ 動画情報 / HLS / AAC取得
   ▼
AAC Audio
   │
   ├──────────────┐
   │              │
   │        Thumbnail
   │              │
   │          Crop / Edit
   │              │
   └──────┬───────┘
          ▼
      NicoPocket
          │
          ├ Title Edit
          ├ Metadata
          ├ Artwork
          └ M4A Packaging
          │
          ▼
     XXXXXXXX.m4a
```

元の `nico_downloader` では、

```text
取得
↓
AAC生成
↓
ダウンロード
```

となる処理を、

```text
取得
↓
AAC生成
↓
NicoPocketで編集・加工
↓
M4A生成
↓
ダウンロード
```

へ変更することを基本方針とします。

---

# Features

## Title Edit

動画タイトルを初期値として、保存前にタイトルを編集できるようにします。

### 予定している処理

- 動画タイトルを初期値として取得
- 保存前に編集可能
- ファイル名として使用できない文字を事前に正規化
- 空文字などの場合は動画ID等へフォールバック
- 最終ファイル名とM4A内部の `title` を一致させる

例：

```text
元タイトル
↓
禁則文字等を正規化
↓
ユーザー編集
↓
finalTitle
├ finalTitle.m4a
└ metadata.title = finalTitle
```

---

## Artwork

ニコニコ動画のサムネイルを取得し、M4Aのアートワークとして利用します。

### 予定している機能

- 動画サムネイル取得
- 正方形トリミング
- トリミング位置の手動調整
- プレビュー
- ArtworkとしてM4Aへ埋め込み

基本的には、

```text
Thumbnail
↓
Square Crop
↓
JPEG
↓
M4A Artwork
```

という流れになります。

### MediaPipe

MediaPipe等を使用して、人物や主要な被写体を基準に初期クロップ位置を自動設定する機能も検討しています。

ただし、これは必須機能ではありません。

実装コストや安定性に問題がある場合は、

```text
中央クロップ
+
手動位置調整
```

を標準動作とします。

---

## Audio

ニコニコ動画から取得したAAC音源を利用します。

可能な限り音声の再エンコードは行わず、

```text
AAC
↓
M4A Container
```

としてremuxすることを優先します。

例えば、

```text
AAC 192 kbps
↓
-c:a copy
↓
M4A / AAC 192 kbps
```

のように、元音源をそのまま利用します。

再エンコードによる不要な音質劣化を避けることを目的としています。

---

## Audio Quality

ニコニコ側で利用可能な音声ストリームをもとに、音質選択機能を追加する予定です。

想定UI：

```text
標準
高音質
最高音質
```

実際に存在しないビットレートを再エンコードによって生成するのではなく、  
**ニコニコ側で配信されている音声ストリームから選択する**方針とします。

利用可能な音声品質が1種類のみの場合は、その品質のみを使用します。

---

## Metadata

ニコニコ動画から取得できる情報をM4Aのメタデータとして埋め込みます。

想定項目：

- Title
- Video ID
- Uploader / Artist
- 投稿日時
- 動画URL
- Description
- Genre
- Series / Album
- Artwork

すべての項目を必須とはせず、取得可能な情報から適切なものを使用します。

特に、

```text
ファイル名 = metadata.title
```

となることを基本仕様とします。

埋め込み予定のメタデータは

- Title
- Video ID
- Uploader / Artist
- 動画URL
- Genre
- Series / Album
- Artwork

---

## UI

UIは既存のNicoPocketモックを基準とします。

動画ページ上のダウンロードボタンを押した時点で即ダウンロードするのではなく、  
NicoPocketの編集ウィンドウを表示します。

想定フロー：

```text
動画ページ
↓
NicoPocketボタン
↓
編集ウィンドウ
├ タイトル
├ Artwork / Crop
├ 音質
└ Download
↓
取得開始
↓
M4A生成
↓
保存
```

動画本体・音声セグメントなどの大きなデータ取得は、原則として編集完了後のダウンロード開始時に行います。

---

# Base Project

NicoPocket は以下のプロジェクトをベースとしています。

- [`masteralice3104/nico_downloader`](https://github.com/masteralice3104/nico_downloader)

NicoPocketでは、主に以下の既存実装を活用する予定です。

- ニコニコ動画ページ上での動作
- 動画ID・動画情報取得
- HLS / m3u8取得
- 音声ストリーム取得
- CMAF / Segment取得
- ffmpeg.wasm
- AAC生成
- stream copy
- Blob生成
- ダウンロード処理
- 既存メタデータ処理

一方で、元プロジェクトのUIや設定画面をそのまま維持することは目的としていません。

NicoPocketでは `nico_downloader` を主に **ニコニコ動画の取得エンジン** として利用し、ユーザー向けUI・保存処理はNicoPocket向けに再構成します。

---

# Development Policy

NicoPocketでは、まず実用可能な状態まで完成させることを優先します。

以下は初期段階では優先しません。

- `nico_downloader` の取得処理の全面的な再設計
- DOM依存の完全排除
- 大規模なアーキテクチャ変更
- Service Worker / Offscreen Documentへの全面移行
- 高度なキュー管理
- 大量の同時ダウンロード
- 複数サイト対応

既存実装を可能な限り流用し、必要な部分のみを追加・変更します。

基本方針：

```text
動くものを作る
↓
実機で検証
↓
問題のある箇所だけ修正
↓
必要に応じて整理・改善
```

---

# Initial Scope

初期バージョンでは以下を優先します。

- [ ] NicoPocket編集ウィンドウ
- [ ] タイトル編集
- [ ] 禁則文字の正規化
- [ ] サムネイル取得
- [ ] 正方形クロップ
- [ ] 手動クロップ位置調整
- [ ] AAC取得
- [ ] M4Aへのremux
- [ ] Artwork埋め込み
- [ ] Metadata埋め込み
- [ ] 編集後タイトルでM4A保存
- [ ] 音質選択

以下は後回し、または任意実装とします。

- [ ] MediaPipeによる自動クロップ
- [ ] 複数動画のキュー処理
- [ ] 並列ダウンロード
- [ ] 高度な設定画面
- [ ] DOM依存の削減

---

# Technical Direction

主に以下の技術を利用する予定です。

- Chrome Extension / Manifest V3
- JavaScript
- ffmpeg.wasm
- Canvas / ImageBitmap
- M4A / MP4 container
- AAC
- HLS / m3u8

必要に応じて以下も検討します。

- MediaPipe
- Web Workers
- Offscreen Document

ただし、新しい技術の導入よりも既存の `nico_downloader` 実装との互換性を優先します。

---

# Development Status

現在は設計・実装準備段階です。

仕様を固定しすぎず、実機検証を行いながら必要な部分を調整していきます。

---

# Usage

現在開発中のため、利用手順はまだ確定していません。

開発時はChromeの拡張機能管理画面から「パッケージ化されていない拡張機能」として読み込む形を想定しています。

```text
chrome://extensions/
```

1. デベロッパーモードを有効化
2. 「パッケージ化されていない拡張機能を読み込む」を選択
3. NicoPocketの拡張機能ディレクトリを選択
4. ニコニコ動画の動画ページを開く

具体的な手順は実装状況に応じて更新します。

---

# Notes

NicoPocketは個人用途を前提として開発しています。

ニコニコ動画側の仕様変更により、取得処理等が動作しなくなる可能性があります。

また、本プロジェクトはニコニコ動画・ドワンゴ等の公式プロジェクトではありません。

利用にあたっては、各サービスの利用規約・著作権・関連法令を遵守してください。

---

# Credits

Base project:

- [`masteralice3104/nico_downloader`](https://github.com/masteralice3104/nico_downloader)

NicoPocketは `nico_downloader` の実装を基礎として開発しています。

元プロジェクトの作者・コントリビューターに感謝します。

---

# License

ライセンスについては、フォーク元 `nico_downloader` のライセンスおよび利用条件を確認した上で設定します。

フォーク元のライセンス条件が適用される部分については、その条件に従います。
