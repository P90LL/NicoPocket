# PHASE10 FIX5 — 最終出力をM4Aへ一本化

## 対象・実サイトでの原因の確度

ユーザーの実サイト確認では、編集後タイトルのM4Aとは別に、元タイトルのAACが保存されている。今回、上流AAC機能との互換性維持より、NicoPocketのM4A専用出力を優先する。

実コード・manifestの読み込み順・保存API・Blob・FFmpeg・仮想FS・旧設定をリポジトリ全体で調査した。FIX3/4時点でも、稼働中の所有ジョブのFFmpeg出力はM4A専用だった。しかし、上流クラスの旧リンククリック、任意拡張子の名前・FSパス、AAC用MIME変換、旧保存形式の読み取りは残っており、ブリッジによる上書きに依存していた。

今回その元実装も変更した。これは確認できた残存経路の除去であり、実サイトで保存されたAACの発火元を捕捉したものではない。旧読み込み済みスクリプト、別の読み込み先や別拡張機能、更新前の保留保存要求が関与したかは未確定。旧設定だけが実サイトAACの原因だったと断定しない。

## 調査結果とcall site

| 箇所 | FIX5前の動作・分類 | 対応 |
| --- | --- | --- |
| `VideoDown`内の`downFile_get` | 旧storageの形式を名前生成へ渡す。所有ジョブでは既存ブリッジがM4A名へ上書きしていた | 形式読み取りを除去。編集タイトルのM4A名だけ使用 |
| `func/ndl.js`の`VideoDownloadNameMake` | 引数の任意拡張子でファイル名を生成可能 | 所有ジョブの正規化済みタイトル + M4Aだけ返す |
| 同クラスの`SetVideoFormat` / `SetVideFormatByExtension` / `CheckVideoFormat` | 任意形式を受け入れる | M4A以外を拒否。直接代入された旧値も確認時に拒否 |
| 同クラスの`FSOutputFileNameSet` / `Get` | 設定形式をFS出力名に使用可能 | 動画ID + M4Aへ固定。別拡張子のパスを拒否 |
| 同クラスの`DownloadLinkClick` | 残存DOMの保存リンクをクリックし完了表示する。ブリッジで上書きしていた | 元メソッド内のclickと完了処理を削除 |
| 同クラスの`ButtonFirstMake` / `ButtonInnerHTMLWrite` / `SaveButtonInnerHTMLMake` / `SaveButtonMake` | 旧ページUI・保存ボタン・onclick文字列を生成可能 | 元メソッドの生成処理を削除。互換名だけ無作用で保持 |
| 同クラスの`SystemMessageAutoOpenToText` | 旧保存ボタンに設定操作用onclickを付与 | 文字列生成を削除。FIX4の取得専用準備は別処理として維持 |
| `dist/utils.js`の`FiletypeToMimetype` | AAC等への変換表。稼働中のM4A Blob生成はこのAAC分岐を使っていなかった | M4A→audio/mp4だけ残し、他形式は拒否 |
| `runFFmpeg_m3u8` / `DownEncoder` | FIX3以降は所有ジョブ・M4A専用 | M4A以外のmodeを拒否、生成前と読出し時のパスを動画IDと照合 |
| 低層`ffmpeg`実行関数 | 任意引数を同梱FFmpegへ渡せる | 最終パスM4A、MP4 muxer、音声copyを実行前に必須化 |
| `FFMPEG_END`後のBlob生成 | audio/mp4 Blobを所有ジョブへ一度だけ渡す | 維持。旧AAC Blob・旧リンクを生成しない |
| `pocket/save.js` | 拡張ウィンドウ内の最終M4Aリンクを一度実行 | 唯一のユーザー保存call siteとして維持・強化 |
| `pocket/artwork.js`のBlob URL | 元画像・JPEG編集プレビュー | 音声保存ではないため維持。download要求なし |
| 同梱FFmpegランタイム | 汎用codec・muxer・FS・Worker用Blob処理 | ランタイムは変更しない。製品のFFmpeg入口ではM4A出力だけ許可 |
| `tool/old.js`等・辞典コード | 未使用のコメント例・取得補助。manifestに含まれない | 実行中の保存入口ではない。コメントを実サイトAACの発火元とは扱わない |

manifestが読み込む独自コードでの`download`属性付与・保存リンクclickは、`pocket/save.js`の1箇所だけ。`chrome.downloads.download`による別の保存開始は存在しない。配信元準備の設定・ログclickと、ファイル保存のclickを区別した。

## AAC codecとAACファイルの区別

残すもの:

- HLS / CMAFの音声入力とAAC codec。
- `audio-aac-192kbps`等の品質IDの解析。
- 音声`-c:a copy`。
- 既存の内部ジョブ・メッセージ名にあるAACという名称。

除去・拒否するもの:

- AACのユーザー保存名、MIME変換、保存リンク・click。
- 旧形式に依存したFS出力名。
- ADTS等の出力muxer、M4A以外の最終パス、音声再エンコード引数。
- AACを一度ファイルへ生成してからM4A化する経路。

HLSから同梱FFmpegへ入力し、最初からM4Aへ直接remuxする。仮想FSの入力playlist・segment・JPEGと、最終M4Aだけを扱う。AACの中間outputやOS側のAAC作成処理は追加していない。

## 旧storage設定

- 取得時に`downFile_setting`を読み取って出力形式を決める処理を除去。
- `options.js`と、読み込み順で同名関数を上書きする`dist/utils.js`の双方で、この互換キーの読み取りをM4A固定にした。
- 互換キーへの書き込みもM4Aへ固定。旧設定メニューで形式選択を復活させない。
- background起動・インストール・Chrome起動時に互換キーをM4Aへ移行する。
- 外部要因で古い値が再度残っても、取得・FFmpeg・保存はそれを形式判定に使わない。

## 修正後の保存フロー

```text
NicoPocketの所有ジョブと現在動画を照合
→ FIX4の配信元取得（必要時だけ準備UIを使用し復帰）
→ 既存HLS/CMAF・音声品質選択
→ 同梱FFmpeg: AAC stream copy + Metadata + JPEG attached_pic
→ 仮想FSの動画ID.m4a
→ audio/mp4 Blob（最終M4Aだけ）
→ owner付き順序チャンク転送
→ pocket/save.jsで所有者・ジョブ・保存名・MIME・コンテナ先頭を検査
→ backgroundで所有保存要求を1件登録
→ 編集後タイトル.m4aを1回保存
→ 保存監視・完了/中断・Blob URLと仮想FSの後始末
```

### save.jsの最終防衛と監査

- sender、取得元タブ、frame、現在ジョブ、ownerがnicopocketであることを照合。
- 保存名は現在ジョブのタイトル + `.m4a`と完全一致、MIMEは`audio/mp4`のみ。
- チャンク順序・サイズ・byte値を確認。
- MP4の`ftyp`ヘッダーがないデータを、保存用Blob URL生成前に拒否。ヘッダー検査だけでコンテナ全体の正常性を証明するものではなく、生成物は別途ffprobe/デコードで検証する。
- 保存開始済みジョブ、重複begin/end、同じjob IDの再送を拒否。再試行・同一動画再保存は新job IDで行う。
- 既存backgroundの同期Setと保存済み状態による重複防止も維持。
- セッション状態に`owner` / job ID / `savedFilename` / `savedExtension` / `savedMime` / `saveCaller` / `saveReadyAt` / `saveRequestCount`を保持。正規要求のcall siteは`pocket/save.js`。
- 署名付き配信URL、認証情報、ファイル内容の診断ログは追加しない。

## 変更ファイル

1. `nico_downloader/func/ndl.js`: 旧保存・ページUI生成を元実装で除去し、名前・形式・FSパスをM4A固定。
2. `nico_downloader/nicovideodownloader_scripts.js`: 取得入口の旧形式storage読み取りを除去。
3. `nico_downloader/dist/utils.js`: M4A専用MIME、出力パス照合、低層FFmpeg引数制限、旧形式読み取り固定。
4. `nico_downloader/options.js`: 互換キーの読み書きと初期値をM4A固定。
5. `nico_downloader/options_menu.js`: 旧形式選択の読み取りを除去、保存時もM4A固定。
6. `nico_downloader/pocket/aac-bridge.js`: 形式固定をジョブ有無に依存させず、旧形式設定を取得準備から除去。転送へownerを付与。
7. `nico_downloader/pocket/save.js`: owner、ヘッダー、保存済み状態、job単位の一度だけの保存を検査。
8. `nico_downloader/pocket/background.js`: 互換設定移行と保存call site・拡張子の監査情報。
9. `nico_downloader/manifest.json`: 内部バージョンを`5.0.0.23`へ更新。表示名・UI・権限は維持。
10. `PHASE10_FIX5.md`: 本記録。

## 検証結果

実コード・同梱FFmpegと、全通信を合成データへ置換した専用Chromeを使用した。検証スクリプト・プロファイル・生成物はリポジトリへ追加していない。

- Chrome storageとページlocalStorageへ旧AAC形式を残して実行。5音質ケース×標準/高音質の10件がM4Aのみ。
- 各jobの保存要求1件。FFmpeg終了通知を二重送信しても、Chrome Download履歴は10件のみ。
- 仮想FSのopenを記録し、AAC名のアクセスがないことを確認。終了後に最終M4A・Artworkの残留なし。
- 専用Downloadディレクトリの全エントリー（dot fileを含む）を調べ、AACやAAC派生一時名なし。実ユーザーのDownloads全体を調査・削除したわけではない。
- AACの比較はメモリ上のpipeで行い、検証用AACファイルをOSへ作成しない。入力とM4A内音声のバイト一致、Metadata、768×768 JPEG attached_pic、全体デコード、シークを確認。
- ブリッジを読み込まない上流コード試験でも、旧リンク生成、AAC名・FSパス、AAC形式、再エンコード引数を拒否。
- 保存境界へAAC名・AACのMIME・誤owner・M4Aへ改名した生AAC相当のデータを送信し、Blob URLと保存clickが0件のまま拒否されることを確認。
- 同時endは1件だけ保存。同じjob IDの再送は拒否、新job IDでは保存可能。
- 初回、同一動画再保存、別動画、保存開始保留のタイムアウト後再試行、Chrome中断後再試行、HLS/FFmpeg失敗後再試行、キャンセル後再試行、Artworkなしを合成環境で確認。
- Artwork編集、drag/zoom/reset/cancel、モーダル中の背面click・wheel・Tab遮断、フォーカス復帰、編集ウィンドウ終了時の遮断解除、ダークUIを確認。UIは変更していない。

### 実サイト・Chrome許可ポップアップ

実サイトでのAAC発火元と、修正後の初回・2回目・別動画・Chrome許可後の保存結果は未確認。先行するComputer UseのGoogle Chrome操作申請が自動承認で拒否されたため、合成結果を実サイトでの解消確認とは扱わない。許可ポップアップそのものの実機動作は、合成の保留・中断試験とは区別する。

実機では読み込み中の拡張機能の内部バージョンが`5.0.0.23`であることを確認し、拡張機能と動画ページを再読み込みする。初回・同一動画2回目・別動画・許可後の保存で、Chrome履歴と保存先がM4A 1件のみとなるか確認する。更新前の保留要求はChromeで手動キャンセルする。

再びAACが出る場合は、時刻・ファイル名の編集前/後の違い・保存元表示・稼働中の拡張機能と読み込み先を確認する。署名付き配信URLや認証情報は収集しない。本実装にはAAC要求の正規call siteは残していないが、別拡張機能や更新前のChromeキューまでこのコードで無効化したとは主張しない。

## 未解決事項

- 実サイトAACの実際の発火元が未特定。実サイトでの最終保存確認が必要。
- Chrome許可UIは自動承認しない。更新前にChromeへ渡された要求は、この変更だけでは遡って取り消せない。
- FIX4の配信元準備・設定UI復帰は維持する。実サイトDOM変更に伴う制限はFIX4記録を参照。

## センシティブ情報・Git

変更した全10ファイルをローカル絶対パス、ユーザー名、資格情報、固定拡張ID、署名付き配信URL、検証用実データについて確認した。センシティブ情報の混入なし。JavaScript構文、manifest JSON、改行方式を考慮した差分チェックも通過。コミット・プッシュは実行しない。
