# Phase 10 FIX — 実機指摘への修正

## 対象

Phase 1〜10の完了後に指摘された旧nico_downloader出力の分離、Download配置、Artwork操作の改善。Metadata仕様、音質選択、FFmpeg引数、JPEG形式は変更しない。コミット・プッシュは実行しない。

## 原因

- `VideoDown`は取得エンジンへの入口と同時に、`ButtonFirstMake`、`SaveButtonMake`を呼び出す旧ページUIの入口でもあった。
- 以前のbridgeは`ButtonTextWrite`と`ButtonFirstMake`を抑止していたが、保存ボタン生成が呼ぶ`ButtonInnerHTMLWrite`を抑止していなかった。既存のページ側ボタンがある場合、そのHTMLを旧保存UIへ書き換える経路が残っていた。
- 所有ジョブの設定が`MovieDownload_domand`時点で行われていたため、それより前の取得開始処理を明確な所有者で分けられていなかった。activeだけに依存する判定は完了後の遅延処理に弱かった。
- FFmpeg完了時はM4Aでも旧IDの保存リンクをページへ挿入し、`document.body.click()`を実行していた。ページ側イベントと共通保存経路へ接触する副作用が残っていた。
- 旧初期設定チェックは保存ボタンのHTMLを読む実装だった。旧UIを外すと取得開始が失敗するため、設定値での確認が必要だった。

実機で指摘されたAACの全発生条件は未確定だが、今回確認できた旧保存・UIへの接触経路を除去した。以前の合成テストでは実際の旧ボタン配置を十分再現できていなかったため、今回そのDOM構造での検証を追加した。過去Phase文書は当時の検証記録として維持する。

## 変更ファイル

| ファイル | 修正内容 |
| --- | --- |
| `nico_downloader/nicovideodownloader_scripts.js` | VideoDownの最初にrequestのジョブ所有者と既存Metadataをdownloaderへ関連付け |
| `nico_downloader/pocket/aac-bridge.js` | 明示的な所有者で旧UI・共通保存を抑止。設定確認のDOM依存を除去。最終BlobからNicoPocket専用保存を実行 |
| `nico_downloader/dist/utils.js` | 共通の生成物読み出し・Blob作成後、所有ジョブはonOutputへ渡して旧リンク生成前に終了 |
| `nico_downloader/pocket/window.html` | Artworkカード外側・直下へDownloadと進捗・状態表示を移動 |
| `nico_downloader/pocket/window.css` | Artwork列と同じ幅のDownload、全面正方形Canvas、ドラッグ中カーソル |
| `nico_downloader/pocket/artwork.js` | 即時ズームを共通化、ホイール対応、ドラッグ状態表示。出力・編集状態の仕様は維持 |
| `PHASE10_FIX.md` | 原因、修正、検証、残件、コミット案 |

## 修正後の保存フロー

```text
NicoPocket Download
→ outputOwner = nicopocketを持つジョブ
→ VideoDownでdownloaderへジョブを関連付け
→ 既存MovieDownload_domand / HLS / CMAF / Segment取得
→ 同梱FFmpegでAAC stream copy + 既存Metadata + JPEG attached picture
→ 既存FS.readFileとBlob生成
→ ジョブのonOutputへM4A Blobと編集後ファイル名を渡す
→ 専用の非接続a要素で最終M4Aだけ保存
→ 既存の保存監視・完了・取消・エラー復帰
```

生成物読み出しとBlob実装を複製していない。NicoPocketでは旧保存リンクをDOMへ挿入せず、body clickも実行しない。専用リンクは旧IDを持たずページに接続しない。保存直前にBlob MIME `audio/mp4`と編集済みタイトル.m4aを確認する。Blob URLは既存のジョブ所有監視へ登録し、終了時に解放する。

旧UIメソッドはdownloaderに保持した所有者を使って抑止する。処理終了後も同じdownloaderによる遅延UI書き換えを抑止する。取得の初期設定確認は準備済みSavemodeを確認し、旧HTMLを参照しない。所有者を持たない旧経路は従来のメソッドへ委譲する。HLS処理・Metadata生成関数・FFmpeg引数は変更しない。

## Downloadレイアウト

左: 保存内容 / Metadata。右: Artworkカード、その外側・直下に同じ幅のDownload。キャンセル、進捗、状態表示も右列へまとめた。狭い画面では保存内容 → Artwork → Downloadの順になる。固定配置は使わず、既存の色・高さ・角丸・disabled状態を維持する。

## Artwork Editor

- Canvas表示を従来の320px上限から、編集領域の幅いっぱいへ拡大。正方形全体が最終Artwork。
- 操作は直接ドラッグとZoom。100〜400%のスライダー、率表示、即時プレビューを維持。
- マウスホイール・トラックパッドの縦スクロールをZoomへ接続。範囲外の値は制限する。
- source画像内のcrop中心x/yを維持してZoomする。縮小して画像端を越える場合のみ空白防止の補正を行う。
- 通常はgrab、ドラッグ中はgrabbing。画像端を超える移動制限を維持。
- リセット / キャンセル / 適用の3ボタンを維持。リセットは中央・100%、キャンセルは適用済み状態を保持。
- 768×768 JPEG / quality 0.9、同じ動画での再編集・別動画での初期化を維持。PNG化は行わない。

## 検証結果

合成配信を使った実際のChrome拡張機能と同梱FFmpegで検証。実ニコニコ動画での成功とは区別する。

- 実際の旧IDを持つページ側ボタン位置を再現し、取得開始から完了・再試行まで旧UIのDOM書き換えなし。
- 旧AACリンクを検証用に投入し、クリックなし、旧保存リンクの再生成なし、保存要求は最終M4Aのみ。
- 完了したdownloaderのUI更新・保存メソッドを再度呼び、遅延処理でも旧UIが再生成されないことを確認。
- 旧UIのない新規ページでも設定チェックと取得が成功。
- 同一動画連続保存、保存開始待ちタイムアウト後再試行、Chrome拒否によるinterrupted後再試行、取得キャンセル後再試行を確認。
- ArtworkカードとDownloadの幅一致・カード直下の位置を広い画面と650px幅で確認。
- 全面正方形Canvas、ドラッグカーソル、Zoomでcrop中心維持、ホイール即時反映、キャンセル保持、リセット中央100%を確認。
- Artwork再編集・適用、768×768 JPEG生成・埋め込み、画像なし・不正画像フォールバック、別動画での初期化と混入防止を確認。
- 音質5ケース×2選択の10保存でAACのバイト一致、既存Metadata、JPEG attached_pic、M4Aデコード、シーク、一時FS後始末を確認。
- HLS / FFmpegの意図的失敗後の復帰・再試行、動画切替・タブ終了を確認。

## Metadata・音質への影響

Metadata生成関数、タグ項目、FFmpeg引数、音質選択ロジックは変更なし。編集済み保存名とmetadata.titleの一致を確認。標準・高音質とも既存AAC stream copyを維持する。

## 実サイトで確認する内容・未解決事項

拡張機能を再読み込みし、動画ページも再読み込みしてから確認する。

1. NicoPocketから保存し、M4A 1ファイルのみでAAC / MP4が出ないこと。
2. ニコニコページへ旧進捗・旧保存完了・旧ボタンが出ず、NicoPocket側に進捗が出ること。
3. 同一動画再保存、別動画、許可・保存先待ち、キャンセル後再試行。
4. Artworkのドラッグ・Zoom・再編集と保存結果、Metadata、プレイヤー再生・シーク。

実サイトの全発生条件の再現とネイティブプレイヤー確認は未実施。更新前の所有者不明の保存要求は引き続きChrome側で手動取消しする。Chromeの許可UIは自動承認しない。これらは既存Known Limitationsを維持する。

## センシティブ情報

変更した全7ファイルを検査済み。センシティブ情報の混入なし。ローカル絶対パス、ユーザー名、資格情報、セッション情報、署名付き一時URL、固定Extension ID、実機検証データの混入を確認した。JavaScript構文と差分検査も合格。合成検証スクリプト・画像・ログはリポジトリ外に保存する。

## 推奨コミット（実行しない）

件名: `fix: NicoPocketの保存経路を分離しArtwork操作を改善`

詳細:

- ジョブ所有者を取得開始時から関連付け、旧保存・進捗・完了UIを抑止
- M4A Blobを専用保存経路へ渡し、旧リンク生成とbody clickを回避
- 旧設定確認のHTML依存を除去し、UIなしでも取得可能に変更
- DownloadをArtworkカード外側の直下へ移し、カードと同じ幅へ調整
- 正方形全体を編集面として表示し、ドラッグ・ズーム・ホイール操作を改善
- Metadata、JPEG埋め込み、音質選択、AAC stream copy、キャンセル・再試行を維持
- 合成データで旧UI書き換えなし、M4Aのみ保存、連続保存、エラー復帰を確認
- AACバイト一致、Metadata、Artwork、デコード・シーク、一時FS削除を確認
- 実サイトでの最終確認事項を記録

対象ファイル: 上記7ファイル。
