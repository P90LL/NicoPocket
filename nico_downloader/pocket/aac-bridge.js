// Adapts the existing VideoDown -> MovieDownload_domand -> DownEncoder pipeline.
// No playlist, segment, FFmpeg argument or Blob implementation is duplicated.
(() => {
    let active = null;
    const owned = downloader => downloader._nicoPocketJob?.outputOwner === 'nicopocket';
    const currentId = () => /^\/watch\/([a-zA-Z0-9]+)\/?$/.exec(location.pathname)?.[1];
    const sameSource = job => active === job && currentId() === job.videoId;
    const notify = (job, phase, error) => chrome.runtime.sendMessage({
        kind: 'np:aac-event', jobId: job.id, phase, error
    }).catch(() => {});
    function cleanupArtwork(job) {
        if (!job.core || job.executing) return;
        for (const path of [job.artworkFile, job.videoId + '.m4a']) {
            if (path) try { job.core.FS.unlink(path); } catch { /* Already removed or never created. */ }
        }
        job.artworkFile = '';
    }
    function stop(job, phase, error, report = true) {
        if (active !== job) return;
        active = null;
        job.controller.abort();
        cleanupArtwork(job);
        job.artwork = null;
        if (job.blobUrl) URL.revokeObjectURL(job.blobUrl);
        clearInterval(job.watch);
        clearTimeout(job.deadline);
        clearTimeout(job.saveDeadline);
        NicovideoDownloader__NowDownloading = false;
        NicovideoDownloader__LoadedVideoSMID = '-1';
        const staleLink = document.getElementById(VideoData.Video_DLlink.a2);
        if (staleLink?.href.startsWith('blob:')) URL.revokeObjectURL(staleLink.href);
        staleLink?.remove();
        if (report) void notify(job, phase, error);
        NicoPocketUI.placeButton();
    }
    const failed = (job, text) => stop(job, 'error', text);
    function guard(job) {
        if (!sameSource(job)) {
            const error = new Error('取得元動画が切り替わりました。');
            error.nicoPocketJobId = job.id;
            throw error;
        }
    }
    // These wrappers apply only while a NicoPocket request is active.
    const option = Option_setLoading;
    Option_setLoading = function (name) {
        if (active && name === 'downFile_setting') return 'm4a';
        if (active && name === 'video_pattern') return active.videoId;
        if (active && name === 'video_hlssave' && (!localStorage.getItem(name) || ['undefined', '0'].includes(localStorage.getItem(name)))) return '1';
        return option(name);
    };
    const makeName = NicoDownloaderClass.prototype.VideoDownloadNameMake;
    NicoDownloaderClass.prototype.VideoDownloadNameMake = function (...args) {
        return owned(this) ? this._nicoPocketJob.title + '.m4a' : makeName.apply(this, args);
    };
    const legacySave = NicoDownloaderClass.prototype.DownloadLinkClick;
    NicoDownloaderClass.prototype.DownloadLinkClick = function (...args) {
        // VideoDown and the page-wide click handler must never click a pending legacy link.
        if ((typeof NicoPocketUI !== 'undefined') || active || owned(this)) return false;
        return legacySave.apply(this, args);
    };
    const buttonText = NicoDownloaderClass.prototype.ButtonTextWrite;
    NicoDownloaderClass.prototype.ButtonTextWrite = function (text) {
        const job = owned(this) ? this._nicoPocketJob : null;
        if (!job) return buttonText.call(this, text);
        if (!sameSource(job) || job.saving) return;
        const match = String(text).match(/([0-9]+(?:\.[0-9]+)?)%/);
        if (match) {
            const progress = Math.min(100, Math.max(0, Math.floor(Number(match[1]))));
            if (job.progress !== progress) {
                job.progress = progress;
                void chrome.runtime.sendMessage({ kind: 'np:aac-event', jobId: job.id, phase: 'acquiring', progress }).catch(() => {});
            }
        }
    };
    // Keep page UI methods inert for this job, even after its async completion.
    for (const name of ['ButtonFirstMake', 'ButtonInnerHTMLWrite', 'SaveButtonMake', 'VideoTitleElementCheck']) {
        const original = NicoDownloaderClass.prototype[name];
        NicoDownloaderClass.prototype[name] = function (...args) {
            if (owned(this)) return true;
            return original.apply(this, args);
        };
    }
    const firstSettings = NicoDownloaderClass.prototype.NicoDownloaderFirstSettingCheck;
    NicoDownloaderClass.prototype.NicoDownloaderFirstSettingCheck = function () {
        // Upstream checks its button's HTML; owned jobs check the prepared setting instead.
        if (owned(this)) return this.Savemode !== '0';
        return firstSettings.call(this);
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
                options.print?.(message); // Shared output extraction; owned jobs bypass legacy links.
            }
        });
        job.core = core;
        if (job.artwork) {
            try {
                const bytes = Uint8Array.from(job.artwork);
                const picture = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
                const valid = picture.width === 768 && picture.height === 768;
                picture.close(); guard(job);
                if (!valid) throw new Error('Artworkのサイズが一致しません。');
                job.artworkFile = 'np-artwork.jpg';
                core.FS.writeFile(job.artworkFile, bytes);
            } catch {
                cleanupArtwork(job);
                console.warn('NicoPocket: Artworkを読み込めないため画像なしで保存します。');
            } finally { job.artwork = null; }
        }
        guard(job);
        const call = core.ccall;
        core.ccall = function (...args) {
            guard(job);
            job.executing = args[0] === 'main';
            if (job.executing) void notify(job, 'processing');
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
            } finally {
                job.executing = false;
                if (args[0] === 'main') cleanupArtwork(job);
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
    const chooseAudio = NicoDownloaderClass.prototype.M3u8ToAudioAndVideoUrlSet;
    NicoDownloaderClass.prototype.M3u8ToAudioAndVideoUrlSet = function (...args) {
        const result = chooseAudio.apply(this, args);
        const job = this._nicoPocketJob;
        if (!job || !result) return result;
        guard(job);
        const selected = NicoPocketAudioQuality.select(this.M3u8.FirstBody_json['EXT-X-MEDIA'] || [],
            job.audioQualities, job.requestedQuality);
        let applied = false;
        if (selected) {
            const lines = this.M3u8.FirstBody.split(/\r?\n/);
            const isAudio = line => /^#EXT-X-MEDIA:/.test(line) && /(?:[:,])TYPE=AUDIO(?:,|$)/.test(line);
            const chosen = lines.find(line => isAudio(line) && line.match(/(?:[:,])URI="([^"]+)"/)?.[1] === selected.item.URI);
            const group = chosen?.match(/(?:[:,])GROUP-ID="([^"]+)"/)?.[1];
            if (group && lines.some(line => /^#EXT-X-STREAM-INF:/.test(line) && /,AUDIO="[^"]+"/.test(line))) {
                // Keep the selected rendition first/only for FFmpeg's existing -map 0:a:0.
                const body = lines.filter(line => !isAudio(line) || line === chosen)
                    .map(line => /^#EXT-X-STREAM-INF:/.test(line)
                        ? line.replace(/,AUDIO="[^"]+"/, ',AUDIO="' + group + '"') : line).join('\n');
                this.SetM3u8('FirstBody', body);
                this.SetM3u8('FirstBody_json', this.Parsem3u8(body));
                this.SetM3u8('AudioM3u8URL', selected.item.URI);
                applied = true;
            }
        }
        void chrome.runtime.sendMessage({ kind: 'np:aac-event', jobId: job.id, phase: 'acquiring',
            audioSelection: { requestedQuality: job.requestedQuality, selectedAudioId: applied ? selected.id : null,
                selectedBitrate: applied ? selected.bitrate : null, fallback: !applied } }).catch(() => {});
        return result;
    };
    const movie = MovieDownload_domand;
    MovieDownload_domand = function (...args) {
        const job = active;
        if (job) {
            guard(job);
            args[1]._nicoPocketJob = job;
            const audios = args[0].GetWatchData()?.media?.domand?.audios;
            if (Array.isArray(audios) && audios.length) job.audioQualities = audios.map(audio => ({ id: audio.id, available: audio.isAvailable === true }));
            args[1]._nicoPocketMetadata = { ...job.metadata, title: job.title, videoId: job.videoId };
        }
        const task = movie(...args);
        if (job) void Promise.resolve(task).then(result => {
            if (result === false) failed(job, '音声プレイリストを取得できませんでした。');
        }, () => failed(job, '音声プレイリストの取得に失敗しました。'));
        return task;
    };
    async function save(job, blob, filename) {
        if (!sameSource(job) || job.saving) return;
        job.saving = true;
        try {
            if (!(blob instanceof Blob) || blob.type !== 'audio/mp4' || filename !== job.title + '.m4a') {
                throw new Error('M4A保存データを確認できませんでした。');
            }
            job.blobUrl = URL.createObjectURL(blob);
            job.saveDeadline = setTimeout(() => failed(job, '保存開始待ちがタイムアウトしました。Chromeの許可・保存先を確認して再試行してください。'), 60000);
            const ready = await chrome.runtime.sendMessage({ kind: 'np:aac-save-ready', jobId: job.id, url: job.blobUrl });
            if (!ready?.ok) throw new Error(ready?.error || 'Chrome側で保存を開始できませんでした。許可や保存先を確認して再試行してください。');
            guard(job);
            // A detached, job-owned final M4A link; never expose a legacy save control.
            const link = document.createElement('a');
            link.href = job.blobUrl; link.download = filename;
            link.click();
        } catch (error) { failed(job, error.message || 'M4Aの保存開始に失敗しました。'); }
    }
    async function prepare(job) {
        const values = await chrome.storage.local.get(['video_hlssave', 'video_pattern', 'language_setting', 'debug', 'downFile_setting']);
        guard(job);
        for (const [key, value] of Object.entries(values)) if (value != null) localStorage.setItem(key, String(value));
        if (!values.video_hlssave || values.video_hlssave === '0') localStorage.setItem('video_hlssave', '1');
        if (!values.language_setting) localStorage.setItem('language_setting', 'ja');
        if (values.debug == null) localStorage.setItem('debug', '0');
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
        const staleLink = document.getElementById(VideoData.Video_DLlink.a2);
        if (staleLink?.href.startsWith('blob:')) URL.revokeObjectURL(staleLink.href);
        staleLink?.remove();
        const result = await VideoDown({ outputOwner: 'nicopocket', job, isCurrent: () => sameSource(job) });
        if (result === false) throw new Error('既存AAC取得処理を開始できませんでした。');
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id || sender.tab) return;
        if (message?.kind === 'np:aac-status') {
            if (active?.id === message.jobId) {
                // Once Chrome starts the download, its terminal events own completion.
                if (message.downloadId != null) clearTimeout(active.saveDeadline);
                if (['complete', 'error'].includes(message.phase)) stop(active, message.phase, message.error, false);
            }
            respond({ ok: true }); return;
        }
        if (message?.kind !== 'np:aac-run') return;
        if (active || message.videoId !== currentId() || location.origin !== 'https://www.nicovideo.jp') {
            respond({ ok: false, error: '処理中、または取得元動画が切り替わっています。' }); return;
        }
        const job = { outputOwner: 'nicopocket', controller: new AbortController(), id: message.jobId, videoId: message.videoId, title: NicoPocketTitle.normalize(message.title, message.videoId), metadata: message.metadata || {}, artwork: Array.isArray(message.artwork) ? message.artwork : null };
        job.requestedQuality = message.requestedQuality === 'high' ? 'high' : 'standard';
        job.audioQualities = Array.isArray(message.audioQualities) ? message.audioQualities : [];
        job.onOutput = (blob, filename) => { void save(job, blob, filename); };
        active = job;
        job.watch = setInterval(() => {
            if (!sameSource(job)) failed(job, '取得元動画が切り替わりました。現在の動画から開き直してください。');
        }, 300);
        job.deadline = setTimeout(() => failed(job, '処理の完了を確認できませんでした。動画ページを再読み込みしてください。'), 30 * 60 * 1000);
        void prepare(job).catch(error => failed(job, error.message || '取得開始に失敗しました。'));
        respond({ ok: true });
    });
    window.addEventListener('unhandledrejection', event => {
        if (event.reason?.nicoPocketJobId && event.reason.nicoPocketJobId !== active?.id) return;
        if (active) {
            failed(active, '既存の取得処理でエラーが発生しました。動画ページのログを確認してください。');
            console.error('NicoPocket AAC', event.reason);
            event.preventDefault();
        }
    });
    window.addEventListener('pagehide', () => { if (active) failed(active, '取得元タブが閉じられたか再読み込みされました。'); });
    globalThis.NicoPocketAAC = { owns: job => sameSource(job), get busy() { return Boolean(active); } };
})();
