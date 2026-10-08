// Adapts the existing VideoDown -> MovieDownload_domand -> DownEncoder pipeline.
// No playlist, segment, FFmpeg argument or Blob implementation is duplicated.
(() => {
    if (globalThis.NicoPocketAAC) return; // Prevent duplicate bridge/listener installation.
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
            discovery(job, 'source_invalidated', { failed: true });
            const error = new Error('取得元動画が切り替わりました。');
            error.nicoPocketJobId = job.id;
            throw error;
        }
    }
    function discovery(job, stage, details = {}) {
        job.sourceDiscovery = { ...job.sourceDiscovery, stage, ...details };
        void chrome.runtime.sendMessage({ kind: 'np:aac-event', jobId: job.id,
            phase: 'acquiring', sourceDiscovery: job.sourceDiscovery }).catch(() => {});
    }
    const sourceVideos = new Map();
    const masterURL = NicoDownloaderClass.prototype.MasterURLGet;
    NicoDownloaderClass.prototype.MasterURLGet = function () {
        const job = this._nicoPocketJob;
        if (!job) return masterURL.call(this);
        guard(job);
        return job.masterUrl || masterURL.call(this);
    };
    const systemReady = NicoDownloaderClass.prototype.CheckSystemMessageContainer;
    NicoDownloaderClass.prototype.CheckSystemMessageContainer = function () {
        const job = this._nicoPocketJob;
        if (!job) return systemReady.call(this);
        guard(job);
        // Discovery was completed before its temporary UI was closed.
        return Boolean(job.masterUrl);
    };
    const visible = element => Boolean(element?.isConnected && element.getClientRects().length
        && getComputedStyle(element).visibility !== 'hidden');
    function settingsPanel() {
        return [...document.getElementsByClassName(VideoData.PlayerSettingClass)].find(visible) || panelWithTitle('動画プレーヤー設定');
    }
    function systemPanel() {
        const dialog = [...document.querySelectorAll('dialog,[role="dialog"]')]
            .find(element => visible(element) && /システムメッセージ/.test(element.textContent || ''));
        if (dialog) return dialog;
        return panelWithTitle('システムメッセージ');
    }
    function panelWithTitle(title) {
        const heading = [...document.querySelectorAll('h1,h2,h3,span,div')].find(element => visible(element)
            && (element.textContent || '').trim() === title);
        for (let panel = heading?.parentElement; panel && panel !== document.body; panel = panel.parentElement) {
            if (closeButton(panel)) return panel;
        }
        return null;
    }
    function closeButton(panel) {
        return panel && [...panel.querySelectorAll('button,[role="button"]')].find(element => visible(element)
            && /閉じる|^close$/i.test((element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim()));
    }
    async function discoverSource(job, downloader) {
        const settings = document.querySelector(VideoData.PlayerSettingQuery);
        const settingsInitiallyOpen = visible(settingsPanel()) || settings?.getAttribute('aria-expanded') === 'true';
        const systemInitiallyOpen = systemPanel();
        const focusBefore = document.activeElement;
        let openedSettings = false, openedSystem = false;
        const deadline = Date.now() + 15000;
        discovery(job, 'checking', { masterAvailable: false, systemMessageAvailable: false, audioCandidateCount: 0 });
        try {
            while (Date.now() < deadline) {
                guard(job);
                const url = masterURL.call(downloader, systemPanel() || document);
                const messages = document.getElementsByClassName(VideoData.SystemMessageContainer);
                if (url && (!sourceVideos.has(url) || sourceVideos.get(url) === job.videoId)) {
                    // Retain the source only in this current job: closing the log may remove its DOM.
                    const parsed = new URL(url);
                    if (parsed.protocol !== 'https:' || parsed.hostname !== 'delivery.domand.nicovideo.jp'
                        || parsed.username || parsed.password) throw new Error('配信元の形式を確認できませんでした。');
                    job.masterUrl = url;
                    sourceVideos.set(url, job.videoId);
                    if (sourceVideos.size > 20) sourceVideos.delete(sourceVideos.keys().next().value);
                    discovery(job, 'source_ready', { masterAvailable: true, systemMessageAvailable: messages.length > 0 });
                    return;
                }
                const video = document.querySelector('video');
                const logButton = [...document.querySelectorAll('button,[role="button"]')]
                    .find(element => visible(element) && (element.textContent || '').trim() === 'システムメッセージを表示');
                discovery(job, messages.length ? 'hls_url_missing' : video && video.readyState === 0
                    ? 'initialization_pending' : 'system_message_pending', { systemMessageAvailable: messages.length > 0 });
                // Existing DOM source is always tried first. Only restore upstream discovery controls.
                if (!openedSystem && !systemInitiallyOpen && logButton) {
                    guard(job); logButton.click(); openedSystem = true;
                } else if (!openedSettings && !settingsInitiallyOpen && !logButton && visible(settings)) {
                    guard(job); settings.click(); openedSettings = true;
                }
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            discovery(job, job.sourceDiscovery.stage, { failed: true });
            throw new Error('音声の配信元を確認できませんでした。動画の再生状態を確認して再試行してください。');
        } finally {
            // Restore only UI opened by this preparation. Never click a save target/body.
            if (currentId() === job.videoId) {
                if (openedSystem && !systemInitiallyOpen) {
                    const panel = systemPanel();
                    const close = closeButton(panel);
                    if (close) close.click();
                    else if (panel instanceof HTMLDialogElement) panel.close();
                    for (let i = 0; i < 10 && systemPanel() && currentId() === job.videoId; i++) await new Promise(resolve => setTimeout(resolve, 50));
                }
                if (openedSettings && !settingsInitiallyOpen) {
                    const panel = settingsPanel();
                    const close = closeButton(panel);
                    if (close) close.click();
                    else if (visible(panel) || settings?.getAttribute('aria-expanded') === 'true') settings?.click();
                    for (let i = 0; i < 10 && (visible(settingsPanel()) || settings?.getAttribute('aria-expanded') === 'true')
                        && currentId() === job.videoId; i++) await new Promise(resolve => setTimeout(resolve, 50));
                }
                if (focusBefore?.isConnected && typeof focusBefore.focus === 'function') focusBefore.focus({ preventScroll: true });
            }
            job.sourceDiscovery.uiRestored = (!openedSystem || !systemPanel() || Boolean(systemInitiallyOpen))
                && (!openedSettings || !visible(settingsPanel()) && settings?.getAttribute('aria-expanded') !== 'true');
            discovery(job, job.sourceDiscovery.stage, { uiRestored: job.sourceDiscovery.uiRestored });
            if (!job.sourceDiscovery.uiRestored && sameSource(job)) {
                throw new Error('配信元確認に使用したプレーヤー画面を閉じられませんでした。閉じてから再試行してください。');
            }
        }
    }
    const playlist = NicoDownloaderClass.prototype.URLToM3u8Set;
    NicoDownloaderClass.prototype.URLToM3u8Set = async function (type, ...args) {
        const job = this._nicoPocketJob;
        if (job) { guard(job); discovery(job, type === 'First' ? 'master_playlist_pending' : 'audio_playlist_pending'); }
        let result;
        try { result = await playlist.call(this, type, ...args); }
        catch (error) { if (job) discovery(job, type === 'First' ? 'master_playlist_missing' : 'audio_playlist_missing', { failed: true }); throw error; }
        if (job) {
            guard(job);
            discovery(job, type === 'First' ? 'master_playlist_ready' : type === 'Audio' ? 'audio_source_ready' : 'video_playlist_ready',
                type === 'First' ? { audioCandidateCount: (this.M3u8.FirstBody_json?.['EXT-X-MEDIA'] || []).length } : {});
        }
        return result;
    };

    // These wrappers apply only while a NicoPocket request is active.
    const option = Option_setLoading;
    Option_setLoading = function (name) {
        if (name === 'downFile_setting') return 'm4a';
        if (active && name === 'video_pattern') return active.videoId;
        if (active && name === 'video_hlssave' && (!localStorage.getItem(name) || ['undefined', '0'].includes(localStorage.getItem(name)))) return '1';
        return option(name);
    };
    const makeName = NicoDownloaderClass.prototype.VideoDownloadNameMake;
    NicoDownloaderClass.prototype.VideoDownloadNameMake = function (...args) {
        return owned(this) ? this._nicoPocketJob.title + '.m4a' : makeName.apply(this, args);
    };
    // This product never resumes upstream page-bound save links.
    NicoDownloaderClass.prototype.DownloadLinkClick = function () { return false; };
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
                console.error('NicoPocket: FFmpeg処理に失敗しました。');
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
        const job = args[0]._nicoPocketJob;
        if (!job || !owned(args[0])) return false;
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
        let result;
        try { result = chooseAudio.apply(this, args); }
        catch (error) {
            if (this._nicoPocketJob) discovery(this._nicoPocketJob, 'audio_rendition_missing', { failed: true });
            throw error;
        }
        const job = this._nicoPocketJob;
        if (!job || !result) { if (job) discovery(job, 'audio_selection_failed', { failed: true }); return result; }
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
        job.audioSelection = { requestedQuality: job.requestedQuality, selectedAudioId: applied ? selected.id : null,
            selectedBitrate: applied ? selected.bitrate : null, fallback: !applied };
        void chrome.runtime.sendMessage({ kind: 'np:aac-event', jobId: job.id, phase: 'acquiring',
            audioSelection: job.audioSelection }).catch(() => {});
        return result;
    };
    const movie = MovieDownload_domand;
    MovieDownload_domand = function (...args) {
        const job = args[1]._nicoPocketJob;
        if (job?.outputOwner !== 'nicopocket') return false;
        if (job) {
            guard(job);
            if (args[0].video_sm !== job.videoId) throw new Error('取得対象の動画IDが一致しません。');
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
            const bytes = new Uint8Array(await blob.arrayBuffer());
            guard(job);
            let reply = await chrome.runtime.sendMessage({ kind: 'np:m4a-transfer', owner: 'nicopocket', stage: 'begin',
                jobId: job.id, filename, mime: blob.type, size: bytes.length });
            if (!reply?.ok) throw new Error(reply?.error || '保存ウィンドウへ接続できませんでした。');
            for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) {
                guard(job);
                reply = await chrome.runtime.sendMessage({ kind: 'np:m4a-transfer', owner: 'nicopocket', stage: 'chunk',
                    jobId: job.id, index, bytes: Array.from(bytes.subarray(offset, offset + 65536)) });
                if (!reply?.ok) throw new Error('M4Aの転送に失敗しました。');
            }
            guard(job);
            job.saveDeadline = setTimeout(() => failed(job, '保存開始待ちがタイムアウトしました。Chromeの許可・保存先を確認して再試行してください。'), 60000);
            reply = await chrome.runtime.sendMessage({ kind: 'np:m4a-transfer', owner: 'nicopocket', stage: 'end', jobId: job.id });
            if (!reply?.ok) throw new Error(reply?.error || 'M4Aの保存を開始できませんでした。');

        } catch (error) { failed(job, error.message || 'M4Aの保存開始に失敗しました。'); }
    }
    async function prepare(job) {
        const values = await chrome.storage.local.get(['video_hlssave', 'video_pattern', 'language_setting', 'debug']);
        guard(job);
        for (const [key, value] of Object.entries(values)) if (value != null) localStorage.setItem(key, String(value));
        if (!values.video_hlssave || values.video_hlssave === '0') localStorage.setItem('video_hlssave', '1');
        if (!values.language_setting) localStorage.setItem('language_setting', 'ja');
        if (values.debug == null) localStorage.setItem('debug', '0');
        const downloader = new NicoDownloaderClass();
        downloader._nicoPocketJob = job;
        await discoverSource(job, downloader);
        guard(job);
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
        job.onError = error => failed(job, error.message || 'M4A生成に失敗しました。');
        job.onOutput = (blob, filename) => { void save(job, blob, filename); };
        active = job;
        job.watch = setInterval(() => {
            if (!sameSource(job)) { discovery(job, 'source_invalidated', { failed: true }); failed(job, '取得元動画が切り替わりました。現在の動画から開き直してください。'); }
        }, 300);
        job.deadline = setTimeout(() => failed(job, '処理の完了を確認できませんでした。動画ページを再読み込みしてください。'), 30 * 60 * 1000);
        void prepare(job).catch(error => failed(job, error.message || '取得開始に失敗しました。'));
        respond({ ok: true });
    });
    window.addEventListener('unhandledrejection', event => {
        if (event.reason?.nicoPocketJobId && event.reason.nicoPocketJobId !== active?.id) return;
        if (active) {
            failed(active, '既存の取得処理でエラーが発生しました。動画ページのログを確認してください。');
            console.error('NicoPocket: 音声取得に失敗しました。');
            event.preventDefault();
        }
    });
    window.addEventListener('pagehide', () => { if (active) failed(active, '取得元タブが閉じられたか再読み込みされました。'); });
    globalThis.NicoPocketAAC = { owns: job => sameSource(job), get busy() { return Boolean(active); } };
})();
