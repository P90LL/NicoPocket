# Phase 10 FIX2 — ダークUI・初回保存・中央Artwork

## 範囲

実機から指摘されたUI差異、未編集Artwork、初回AAC/M4A二重保存の入口を修正。Metadataタグ、音質選択、FFmpeg引数、768×768 JPEG、AAC stream copyは維持する。直前のFIXは未コミットのため作業ツリーへ保持し、その上へ今回の修正を追加した。コミット・プッシュは実行しない。

## 初回二重保存の調査と修正

前のFIXでは所有ジョブの旧UI・保存を抑止したが、ジョブがない初期状態での`VideoDown()`呼び出しと`DownloadLinkClick()`は依然として旧経路へ進めた。旧IDのBlobリンクが初回ロード時に存在する場合、NicoPocketのジョブ設定前にクリックされる余地もあった。所有者のないFFmpeg完了処理にも旧リンク生成の余地が残っていた。

今回、NicoPocket製品の入口・旧リンク・出力の3箇所で制限した。

1. `VideoDown`はNicoPocket UIが存在する場合、現在の所有ジョブを伴う要求だけを受け付ける。ジョブID・動画一致を既存のbridge状態で確認し、旧初期化呼び出しは取得開始前に終了する。
2. `DownloadLinkClick`はNicoPocket製品では所有状態の前後を問わず旧保存を実行しない。
3. document_startで設置済みのcontent処理から、既知の旧`downloadlink`を無効化・解放・削除する。挿入直後の同期クリックもcapture listenerで取消す。無関係なページのDownloadは変更しない。
4. FFmpeg完了時、NicoPocket製品内の所有者なし出力は旧Blobリンク生成へ進めない。所有M4Aは前FIXの専用保存へ渡す。

`NicoPocketUI`はトップレベルconstでありwindowのプロパティではないため、実際のスクリプト変数で存在を判定する。ジョブ状態は明示的なbridge所有者判定を使う。

修正後:

```text
初回から所有NicoPocket要求だけを受け付ける
→ 既存HLS / CMAF / Segment取得
→ 同梱FFmpeg・AAC stream copy
→ 既存Metadata + JPEG attached picture
→ 最終M4A Blob
→ NicoPocket専用保存
→ M4A 1ファイル
```

これらの漏れを合成環境で再現・検証した。実サイトで起きた初回だけの全条件、既にChromeへ渡された過去要求の正体までは未確定。更新前から保留されていた所有者不明の要求を安全に遡って取消すことはできない。Chromeで手動取消しし、拡張機能と動画ページを再読み込みして最終確認する。

## UI変更

- メイン画面、Artworkモーダル、案内画面をダークテーマ固定に変更。OS・ブラウザのライト設定へ追従しない。ニコニコページへ広いテーマCSSを適用しない。
- EDIT WINDOW / 保存内容を編集 / 導入説明を領域ごと削除。ヘッダー直下からカードを開始。
- 「保存するメタデータ」へ変更。左カードのgrid stretchを解除し、閉じた見出しの下は通常のカードpaddingだけにする。展開表示は維持。
- 音質候補件数と未取得補足を除去し、ストリーム選択仕様の説明だけを表示。
- Artworkカード直下のDownload配置を維持し、説明・状態文の上へ16pxの余白を追加。
- 完了はダークテーマのsuccess色、エラーはerror色を使う。disabled・進捗・再試行は維持。

## 未編集Artwork

サムネイル取得・デコード成功後、中央の1:1領域をCanvasで768×768 JPEG（quality 0.9）へ変換し、既存の`NicoPocketEditor.artwork.blob`へ保持する。editedはfalseのまま、プレビューは中央クロップ、表示は「中央クロップ」とする。

Downloadが画像ロード中に押された場合は既存の画像読み込み完了を待ってBlobを取得する。画像取得・デコード・生成失敗時はBlobなしで音声+Metadata保存を継続する。ロードには既存の20秒上限がある。動画・タブ・URL・thumbnail一致と世代管理を維持し、別動画の画像を混ぜない。

編集後は同じBlob入口を編集結果へ上書きする。M4A埋め込み・Metadataの仕様変更は行わない。

## Artwork編集面

Archiveの画像stageとcrop枠の構成を参考に、最大960pxの専用編集モーダルへ変更。元サムネイルを同じ移動・倍率で広い背景へ描画し、周囲を暗くして固定の明るい正方形を最終出力範囲として示す。正方形Canvasがそのまま最終JPEG出力になる。

ドラッグ・スライダー100〜400%・ホイールZoom・リセット・キャンセル・適用だけを維持。背景部分もドラッグ・Zoomできる。Zoomはsource画像内のcrop中心を維持し、端を越える場合だけ補正する。中央移動、最大化、Fit、AI解析は追加しない。

「元画像へ戻す」はメインUI、DOM参照、event listener、状態変更処理から削除。リセットはモーダル内だけで行う。変更後もキャンセルは適用済みBlobを保持する。

## 変更ファイル

| ファイル | 内容 |
| --- | --- |
| `nico_downloader/nicovideodownloader_scripts.js` | 初期状態の所有者なしVideoDownを拒否 |
| `nico_downloader/pocket/aac-bridge.js` | 旧保存入口の常時抑止、現在の所有ジョブ確認 |
| `nico_downloader/pocket/content.js` | 旧保存リンクの初期・同期クリック抑止 |
| `nico_downloader/dist/utils.js` | 所有者なし旧FFmpeg保存出力を抑止 |
| `nico_downloader/pocket/window.html` | 上部説明・元画像ボタン削除、日本語見出し、広いArtwork stage |
| `nico_downloader/pocket/window.css` | ダーク固定、余白、折りたたみ高さ、編集面、状態色 |
| `nico_downloader/pocket/window.js` | 件数削除、画像生成待ち、Artwork欠損文言、状態色用属性 |
| `nico_downloader/pocket/artwork.js` | 自動中央JPEG、広い背景、元画像操作削除、画像準備待ち |
| `nico_downloader/pocket/about.css` | 案内画面のダーク固定 |
| `nico_downloader/options.html` | 未編集Artworkの案内更新 |
| `README.md` | 中央Artwork・ダーク固定・現記録への参照 |
| `PHASE10_FIX2.md` | 本記録 |

## 検証

合成配信、実際のChrome拡張機能、同梱FFmpegを使用。実サイトの成功とは区別する。

- 所有者なし初回VideoDownがfalseを返し、取得を始めないことを確認。
- 旧AACリンクを挿入直後に同期クリックしてもDownloadなし、旧リンク残留なし。
- 初回、同一動画2回目、別動画、保存拒否によるinterrupted後再試行でM4Aのみ保存。
- 旧ページ側UI変更・旧リンク再生成・旧AACリンククリックなし。
- 未編集で自動中央Artworkが生成され、attached_picとして保存されることを確認。
- 音質5ケース×標準/高の10出力でAACバイト一致、Metadata、768×768 Artwork、全体デコード・シーク、一時FS削除を確認。
- 画像取得500エラーでも音声+MetadataのみのM4A保存を2回確認。
- 編集・再編集・Zoom中心維持・ホイール・背景からのドラッグ・キャンセル・リセット・別動画初期化を確認。
- HLS/FFmpeg失敗後再試行、動画切替・タブ終了、不正JPEGフォールバックを確認。
- ライト設定を模擬してもcolor-scheme dark、閉じたメタデータの下が通常paddingだけ、説明上16pxを確認。
- 広い画面、650px幅、400px縦長、メタデータ展開、モーダル表示を確認。

## 実サイト確認事項

1. 拡張機能と動画ページを再読み込みし、初回からM4A 1ファイルだけ保存されること。
2. 同一動画再保存・別動画・Chrome許可後もAAC/MP4が出ないこと。
3. ページへ旧進捗・旧保存UIが出ず、NicoPocket側だけに進捗が出ること。
4. 未編集中央Artwork・編集Artwork・画像失敗時の保存、プレイヤー再生とシーク。
5. ダーク表示・カード余白・広い編集面の実際の操作感。

ネイティブChrome許可ポップアップ、実サイトの全再現条件、プレイヤー表示は未確認。既存Known Limitationsを維持する。PNG化、Metadata追加、再エンコード、大規模な取得変更は行わない。

## センシティブ情報チェック

今回の変更と未コミットの前FIXを含む全13ファイルを検査済み。センシティブ情報の混入なし。ローカルパス・ユーザー名・資格情報・セッション・署名付きURL・実配信URL・固定Extension IDの混入を確認した。JavaScript構文と差分検査も合格。合成検証スクリプト、画像、ログはリポジトリ外に置く。

## 推奨コミット（一括・実行しない）

件名: `fix: 初回の旧保存を抑止しNicoPocketのダークUIを調整`

- 所有ジョブ以外の取得・旧保存を抑止し、初回からM4A専用経路へ限定
- 旧AACリンクの初期残留と同期クリックを無効化
- 独自UIをダーク固定にし、上部説明と不要な余白・件数表示を整理
- 未編集サムネイルの中央クロップJPEGを自動生成して埋め込み
- 広い背景と固定正方形のArtwork編集面へ変更
- 元画像復帰ボタンと関連処理を削除
- Metadata、音質選択、AAC stream copy、再試行を維持
- 合成検証で初回・連続・別動画のM4Aのみ保存、Artwork欠損時保存を確認
- AACバイト一致、Metadata、attached_pic、デコード・シークを確認
- 実サイト確認事項と検証範囲を記録

前FIXが未コミットなので、GitHub Desktopで一括コミットする場合は`PHASE10_FIX.md`を含む全変更が対象になる。
