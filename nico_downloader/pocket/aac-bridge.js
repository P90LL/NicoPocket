// Adapts the existing VideoDown -> MovieDownload_domand -> DownEncoder pipeline.
// No playlist, segment, FFmpeg argument or Blob implementation is duplicated.
(() => {
    let active = null;
    const currentId = () => /^\/watch\/([a-zA-Z0-9]+)\/?$/.exec(location.pathname)?.[1];
    const sameSource = job => active === job && currentId() === job.videoId;
    const notify = (job, phase, error) => chrome.runtime.sendMessage({
        kind: 'np:aac-event', jobId: job.id, phase, error
    }).catch(() => {});
    function stop(job, phase, error, report = true) {
        if (active !== job) return;
        active = null;
        job.controller.abort();
        clearInterval(job.watch);
        clearTimeout(job.deadline);
        clearTimeout(job.saveDeadline);
        NicovideoDownloader__NowDownloading = false;
        NicovideoDownloader__LoadedVideoSMID = '-1';
        document.getElementById(VideoData.Video_DLlink.a2)?.remove();
        if (report) void notify(job, phase, error);
        NicoPocketUI.placeButton();
    }
    const failed = (job, text) => stop(job, 'error', text);
    function guard(job) {
        if (!sameSource(job)) throw new Error('取得元動画が切り替わりました。');
    }
    // These wrappers apply only while a NicoPocket request is active.
    const option = Option_setLoading;
    Option_setLoading = function (name) {
        if (active && name === 'downFile_setting') return 'm4a';
        if (active && name === 'video_pattern') return active.videoId;
        if (active && name === 'video_hlssave' && (!localStorage.getItem(name) || localStorage.getItem(name) === 'undefined')) return '1';
        return option(name);
    };
    const makeName = NicoDownloaderClass.prototype.VideoDownloadNameMake;
    NicoDownloaderClass.prototype.VideoDownloadNameMake = function (...args) {
        return active ? active.title + '.m4a' : makeName.apply(this, args);
    };
    const firstButton = NicoDownloaderClass.prototype.ButtonFirstMake;
    NicoDownloaderClass.prototype.ButtonFirstMake = function () {
        if (!active) return firstButton.call(this);
        let row = document.getElementById(VideoData.Video_DLlink.p);
        if (!row) {
            row = document.createElement('p'); row.id = VideoData.Video_DLlink.p;
            row.hidden = true; document.body.append(row);
        }
        if (!document.getElementById(VideoData.Video_DLlink.a)) {
            const status = document.createElement('span'); status.id = VideoData.Video_DLlink.a;
            row.append(status);
        }
        return true;
    };
    const check = NicoDownloaderClass.prototype.CheckBeforeDownload;
    NicoDownloaderClass.prototype.CheckBeforeDownload = function () {
        let ready;
        try { ready = check.call(this); } catch (error) {
            if (active) failed(active, '動画の再生状態を確認できませんでした。再生してから再度実行してください。');
            throw error;
        }
        if (active && !ready) failed(active, '取得開始に必要な動画・設定情報を確認できませんでした。');
        return ready;
    };
    const coreFactory = createFFmpegCore;
    createFFmpegCore = async function (options) {
        const job = active;
        if (!job) return coreFactory(options);
        guard(job);
        const core = await coreFactory({
            ...options,
            printErr: message => {
                options.printErr?.(message);
                if (/out of memory|Array buffer allocation failed|Conversion failed|Error opening output|Invalid data found/i.test(message)) {
                    failed(job, 'FFmpeg処理に失敗しました。動画ページのログを確認してください。');
                }
            },
            print: message => {
                if (!sameSource(job)) return;
                options.print?.(message); // Original Blob and save-link generation.
                if (String(message).startsWith('FFMPEG_END')) void save(job);
            }
        });
        const call = core.ccall;
        core.ccall = function (...args) {
            guard(job);
            try {
                const result = call.apply(this, args);
                if (args[0] === 'main' && typeof result === 'number' && result !== 0) {
                    failed(job, 'FFmpeg処理がエラーで終了しました。');
                }
                return result;
            } catch (error) {
                // Emscripten may signal successful process exit by throwing ExitStatus(0).
                if (error?.status === 0 && job.saving) return 0;
                console.error('NicoPocket FFmpeg', error);
                failed(job, 'FFmpeg処理に失敗しました。動画ページのログを確認してください。');
                throw error;
            }
        };
        return core;
    };
    const textDownload = NicoDownloaderClass.prototype.DownloadTextWithCookie;
    NicoDownloaderClass.prototype.DownloadTextWithCookie = async function (...args) {
        const job = this._nicoPocketJob;
        if (job) guard(job);
        const text = await textDownload.apply(this, args);
        if (job) guard(job);
        return text;
    };
    const retryFetch = fetch_retry;
    fetch_retry = function (url, downloader, options, retries) {
        const job = downloader._nicoPocketJob;
        if (!job) return retryFetch(url, downloader, options, retries);
        guard(job);
        return retryFetch(url, downloader, { ...options, signal: job.controller.signal }, retries);
    };
    const encoder = DownEncoder;
    DownEncoder = function (...args) {
        const job = args[0]._nicoPocketJob || active;
        if (job) guard(job);
        const task = encoder(...args);
        if (job) {
            void notify(job, 'acquiring');
            void Promise.resolve(task).then(result => {
                if (result === false) failed(job, 'AAC取得を開始できませんでした。');
            }, () => failed(job, 'AAC取得に失敗しました。動画ページのログを確認してください。'));
        }
        return task;
    };
    const movie = MovieDownload_domand;
    MovieDownload_domand = function (...args) {
        const job = active;
        if (job) { guard(job); args[1]._nicoPocketJob = job; }
        const task = movie(...args);
        if (job) void Promise.resolve(task).then(result => {
            if (result === false) failed(job, '音声プレイリストを取得できませんでした。');
        }, () => failed(job, '音声プレイリストの取得に失敗しました。'));
        return task;
    };
    async function save(job) {
        if (!sameSource(job) || job.saving) return;
        job.saving = true;
        try {
            const link = document.getElementById(VideoData.Video_DLlink.a2);
            if (!link?.href.startsWith('blob:') || !link.download.endsWith('.m4a')) {
                throw new Error('M4A保存用リンクを生成できませんでした。');
            }
            const ready = await chrome.runtime.sendMessage({ kind: 'np:aac-save-ready', jobId: job.id, url: link.href });
            if (!ready?.ok) throw new Error('保存状態の監視を開始できませんでした。');
            guard(job);
            // Reuse the upstream final link click and cleanup.
            new NicoDownloaderClass().DownloadLinkClick();
            void notify(job, 'saving');
            job.saveDeadline = setTimeout(() => failed(job, '保存の開始を確認できませんでした。保存ダイアログと動画ページを確認してください。'), 60000);
        } catch (error) { failed(job, error.message || 'M4Aの保存開始に失敗しました。'); }
    }
    async function prepare(job) {
        const values = await chrome.storage.local.get(['video_hlssave', 'video_pattern', 'language_setting', 'debug', 'downFile_setting']);
        guard(job);
        for (const [key, value] of Object.entries(values)) if (value != null) localStorage.setItem(key, String(value));
        if (values.video_hlssave == null) localStorage.setItem('video_hlssave', '1');
        const downloader = new NicoDownloaderClass();
        const settings = document.querySelector(VideoData.PlayerSettingQuery);
        if (!downloader.MasterURLGet()) settings?.click();
        const deadline = Date.now() + 15000;
        while (!downloader.MasterURLGet()) {
            guard(job);
            const logButton = [...document.querySelectorAll('button,[role="button"]')]
                .find(element => (element.textContent || '').trim() === 'システムメッセージを表示');
            logButton?.click();
            if (Date.now() > deadline) throw new Error('音声の配信元を確認できませんでした。再生してから再度実行してください。');
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        guard(job);
        last_save_sm = '';
        NicovideoDownloader__LoadedVideoSMID = '-1';
        document.getElementById(VideoData.Video_DLlink.a2)?.remove();
        const result = await VideoDown({ isCurrent: () => sameSource(job) });
        if (result === false) throw new Error('既存AAC取得処理を開始できませんでした。');
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id || sender.tab) return;
        if (message?.kind === 'np:aac-status') {
            if (active?.id === message.jobId) {
                if (message.downloadId != null) clearTimeout(active.saveDeadline);
                if (['complete', 'error'].includes(message.phase)) stop(active, message.phase, message.error, false);
            }
            respond({ ok: true }); return;
        }
        if (message?.kind !== 'np:aac-run') return;
        if (active || message.videoId !== currentId() || location.origin !== 'https://www.nicovideo.jp') {
            respond({ ok: false, error: '処理中、または取得元動画が切り替わっています。' }); return;
        }
        const job = { controller: new AbortController(), id: message.jobId, videoId: message.videoId, title: NicoPocketTitle.normalize(message.title, message.videoId) };
        active = job;
        job.watch = setInterval(() => {
            if (!sameSource(job)) failed(job, '取得元動画が切り替わりました。現在の動画から開き直してください。');
        }, 300);
        job.deadline = setTimeout(() => failed(job, '処理の完了を確認できませんでした。動画ページを再読み込みしてください。'), 30 * 60 * 1000);
        void prepare(job).catch(error => failed(job, error.message || '取得開始に失敗しました。'));
        respond({ ok: true });
    });
    window.addEventListener('unhandledrejection', event => {
        if (active) {
            failed(active, '既存の取得処理でエラーが発生しました。動画ページのログを確認してください。');
            console.error('NicoPocket AAC', event.reason);
            event.preventDefault();
        }
    });
    window.addEventListener('pagehide', () => { if (active) failed(active, '取得元タブが閉じられたか再読み込みされました。'); });
    globalThis.NicoPocketAAC = { get busy() { return Boolean(active); } };
})();
