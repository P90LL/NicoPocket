//ダウンロード関数

async function VideoDown(request) {
    // In the NicoPocket product, acquisition starts only through an owned request.
    if (request?.outputOwner !== 'nicopocket' || !request.job
        || globalThis.NicoPocketAAC?.owns(request.job) !== true) return false;
    if (request.job.acquisitionStarted) return false;
    request.job.acquisitionStarted = true;
    // 必要なクラスの初期化
    const NicoDownloader = new NicoDownloaderClass(); //NicoDownloaderクラスの初期化
    const Nicovideo = new NicovideoClass(); //NicovideoClassクラスの初期化
    // Bind ownership before any legacy UI or save method can run.
    if (request?.outputOwner === 'nicopocket') {
        NicoDownloader._nicoPocketJob = request.job;
        NicoDownloader._nicoPocketMetadata = { ...request.job.metadata, title: request.job.title, videoId: request.job.videoId };
    }

    //そもそもマッチするか確認
    if (Nicovideo.CheckNicovideoWatchURL() == false) return false;

    // Downloadingがtrueの場合は終了
    if (NicoDownloader.VideoDownloadingCheck()) return false;

    // Acquisition only: final output is saved by the background-owned M4A job.

    // 現在のページのsm番号の取得しセット
    Nicovideo.video_sm = Nicovideo.VideoSmGet(NicoDownloader.MatchingSMIDArray);

    await Nicovideo.SetAllFromVideoSm(Nicovideo.video_sm);
    if (request && !request.isCurrent()) return false;

    await new Promise(async (resolve, reject) => {
        // sm番号かタイトルが取得できなかったら終了
        if (Nicovideo.video_sm == "" || Nicovideo.video_title == "")
            reject("video_sm or video_title is null");

        // Output names come only from the owned editor job, never legacy format preferences.
        if (!request.isCurrent()) { reject(new Error('取得元動画が切り替わりました。')); return; }
        const video_name = NicoDownloader.VideoDownloadNameMake(Nicovideo.video_sm, Nicovideo.video_title);
        Nicovideo.video_name = video_name;
        //DebugPrint("video_name:" + Nicovideo.video_name);

        // すでに作ったリンクがあるかどうか判別し、あれば削除
        NicoDownloader.VideoTitleElementCheck(Nicovideo.video_sm);

        // resolve
        resolve();
    });
    DebugPrint("video_name:" + Nicovideo.video_name);

    //ダウンロードリンクの表示
    if (!NicoDownloader.VideoLoadedCheck(Nicovideo.video_sm)) {
        //ここがtrueになるとすでに読み込み済み

        new Promise((resolve, reject) => {
            //ボタンをとりあえず作成
            // No legacy button or save link is created for an owned request.

            NicoDownloader.ButtonTextWrite("処理開始"); //ボタンの文字を変更

            // 保存ボタンを作成
            DebugPrint("video_name_savebutton:" + Nicovideo.video_name);


            //ダウンロード前のチェック処理
            if (NicoDownloader.CheckBeforeDownload() == false)
                reject("CheckBeforeDownload ERROR");

            if (NicoDownloader.VideoDownloadingCheck()) reject("Now Downloading"); //ダウンロード中は終了

            // resolve
            resolve();
        })
            .then(() => {
                if (request && !request.isCurrent()) return false;
                ////////////////////////////////////////////////////////////////
                // ここから実行部分
                ////////////////////////////////////////////////////////////////

                // systemMessageContainerからmasterURLを取得
                const masterURL = NicoDownloader.MasterURLGet();
                if (masterURL == false) return false; // masterURLが取得できなかった場合は終了

                DebugPrint("masterURL:" + masterURL);

                if (NicoDownloader.VideoDownloadingCheck()) return false; //ダウンロード中は終了

                //delivery.domand.nicovideo.jpの処理はこちら！
                if (masterURL.indexOf("delivery.domand.nicovideo.jp") != -1) {
                    // ダウンロード処理
                    MovieDownload_domand(Nicovideo, NicoDownloader).then(() => {
                        NicoDownloader.VideoDownloadingReset(); // ダウンロード中をリセット
                    });

                    NicoDownloader.VideoLoadedSMIDSet(Nicovideo.video_sm); // ダウンロードしたsm番号を記録
                }
            })
            .catch((value) => {
                DebugPrint("NDLDL");
                DebugPrint(value);
                return false;
            });
    }
    return true;
}
let interval1st = false;
let intervalId;
try {
    clearInterval(intervalId);

    // Phase 1: 2秒ごとにNicoPocketの編集ボタンを配置
    intervalId = setInterval(() => {
        if (interval1st) {
            // 2回目以降は実行
            try {
                NicoPocketUI.placeButton();
            } catch (e) {
                console.log(e);
            }
        } else {
            // 1回目は実行しない
            interval1st = true;
        }
    }, 2000);
} catch (error) {
    console.log(e);
}

//ページ表示時発火処理
window.onload = function () {
    Option_setLoading("video_downloading"); // デフォルト保存名の読み込み
};

function documentWriteText(URItext) {
    document.getElementById(VideoData.Video_DLlink.a).innerHTML =
        VideoData.DLButton.a +
        VideoData.DLButton.b +
        URItext +
        VideoData.DLButton.c;
}

/**
 *
 * @param {NicovideoClass} Nicovideo
 * @param {NicoDownloaderClass} NicoDownloader
 */

async function MovieDownload_domand(Nicovideo, NicoDownloader) {
    //Firstm3u8URLを取得
    const Firstm3u8URL = NicoDownloader.MasterURLGet();

    //Firstm3u8URLの取得に失敗した場合は終了
    if (Firstm3u8URL == false) return false;

    //Firstm3u8URLの取得に成功した場合
    await NicoDownloader.URLToM3u8Set("First", Firstm3u8URL); //Firstm3u8URLをセット

    //Firstm3u8URLからaudio_m3u8_URLとvideo_m3u8_URLを取得
    if (NicoDownloader.M3u8ToAudioAndVideoUrlSet() == false) return false;

    //audio_m3u8_URLとvideo_m3u8_URLを取得できた場合
    //audio_m3u8_URLとvideo_m3u8_URLを元にaudio_m3u8_bodyとvideo_m3u8_bodyを取得
    await NicoDownloader.URLToM3u8Set("Audio", NicoDownloader.M3u8.AudioM3u8URL);
    await NicoDownloader.URLToM3u8Set("Video", NicoDownloader.M3u8.VideoM3u8URL);

    // m3u8sを取得
    const m3u8s = [
        NicoDownloader.M3u8Class.ReplaceURLToM3u8s(NicoDownloader.M3u8.AudioBody),
        NicoDownloader.M3u8Class.ReplaceURLToM3u8s(NicoDownloader.M3u8.VideoBody),
        NicoDownloader.M3u8Class.ReplaceURLToM3u8s(NicoDownloader.M3u8.FirstBody),
        NicoDownloader.M3u8Class.MakeTSFilename(NicoDownloader.M3u8.AudioM3u8URL),
        NicoDownloader.M3u8Class.MakeTSFilename(NicoDownloader.M3u8.VideoM3u8URL),
        NicoDownloader.M3u8Class.MakeTSFilename(Firstm3u8URL),
    ];

    // TSファイルのURLを取得
    NicoDownloader.TSURLs =
        NicoDownloader.M3u8Class.MakeURLListToTSURLs(NicoDownloader);

    // TSファイル名を取得
    NicoDownloader.TSFilenames =
        NicoDownloader.M3u8Class.MakeTSFileNameListtoArray(NicoDownloader);

    NicoDownloader.ButtonTextWrite("処理中"); //ボタンの文字を変更
    DownEncoder(NicoDownloader, m3u8s, Nicovideo);
}
