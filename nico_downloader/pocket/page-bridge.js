(function () {
// 動画番号を含むページ側POST応答のcontentUrlを、番号と組にして保持する。
(() => {
    if (globalThis.chrome?.runtime?.id) return;
    const channel = 'nico-downloader-playlist-source-v1', records = new Map();
    let client = '', order = 0;
    const validURL = value => {
        try { const u = new URL(value); return u.origin === 'https://delivery.domand.nicovideo.jp' && !u.username && !u.password && /^\/hlsbid\/[^/]+\/playlists\/.+/.test(u.pathname); }
        catch { return false; }
    };
    const publish = entry => { if (client) window.postMessage({ channel, client, type: 'source', ...entry }, location.origin); };
    window.addEventListener('message', event => {
        const d = event.data;
        if (event.source !== window || event.origin !== location.origin || d?.channel !== channel || d.type !== 'subscribe' || typeof d.client !== 'string' || d.client.length > 100) return;
        client = d.client;
        for (const entry of records.values()) publish(entry);
    });
    const identify = (url, method) => {
        try {
            const u = new URL(url, location.href);
            return String(method).toUpperCase() === 'POST' && u.origin === 'https://nvapi.nicovideo.jp'
                ? u.pathname.match(/^\/v[0-9]+\/(?:watch|shorts)\/((?:sm|ss)[0-9]+)(?:\/|$)/)?.[1] : null;
        } catch { return null; }
    };
    async function receive(videoId, requestOrder, read, status) {
        if (status !== 200) return;
        try {
            const json = JSON.parse(await read());
            if (json?.meta?.status !== 200 || !validURL(json?.data?.contentUrl)) return;
            if ((records.get(videoId)?.order || 0) > requestOrder) return;
            const entry = { videoId, url: json.data.contentUrl, receivedAt: Date.now(), order: requestOrder };
            records.delete(videoId); records.set(videoId, entry);
            while (records.size > 8) records.delete(records.keys().next().value);
            publish(entry);
        } catch { /* ページ本来の処理に影響させない。 */ }
    }
    const fetch = window.fetch;
    window.fetch = function(input, init) {
        let videoId;
        try {
            const req = typeof Request !== 'undefined' && input instanceof Request;
            videoId = identify(req ? input.url : input, init?.method ?? (req ? input.method : 'GET'));
        } catch {}
        const requestOrder = videoId ? ++order : 0;
        const result = Reflect.apply(fetch, this, arguments);
        if (videoId) result.then(response => {
            if (response.status !== 200) return;
            const copy = response.clone(); return receive(videoId, requestOrder, () => copy.text(), response.status);
        }).catch(() => {});
        return result;
    };
    const requests = new WeakMap(), open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        const result = Reflect.apply(open, this, arguments); requests.set(this, { method, url }); return result;
    };
    XMLHttpRequest.prototype.send = function() {
        const request = requests.get(this), videoId = request && identify(request.url, request.method);
        if (videoId) {
            const requestOrder = ++order;
            const finish = () => {
                this.removeEventListener('loadend', finish);
                if (requests.get(this) !== request) return;
                receive(videoId, requestOrder, () => this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText, this.status);
            };
            this.addEventListener('loadend', finish);
            try { return Reflect.apply(send, this, arguments); }
            catch (error) { this.removeEventListener('loadend', finish); throw error; }
        }
        return Reflect.apply(send, this, arguments);
    };
    window.postMessage({ channel, type: 'ready' }, location.origin);
})();

// ページが受信したlazy動画情報から、必要な投稿者名・シリーズ名だけを渡す。
(() => {
    if (globalThis.chrome?.runtime?.id) return;
    const channel = 'nico-downloader-watch-metadata-v1';
    let client = '', cached = null, href = location.href, generation = 0, order = 0;
    const route = () => location.pathname.match(/^\/watch\/(sm[0-9]+)\/?$/)?.[1] || '';
    const sync = () => {
        if (href !== location.href) { href = location.href; cached = null; generation++; }
    };
    const publish = () => {
        sync();
        if (client && cached && cached.href === location.href && cached.videoId === route()) {
            window.postMessage({ channel, client, type: 'metadata', ...cached }, location.origin);
        }
    };
    window.addEventListener('message', event => {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin || data?.channel !== channel ||
            data.type !== 'subscribe' || typeof data.client !== 'string' || data.client.length > 100) return;
        client = data.client;
        publish();
    });
    for (const name of ['popstate', 'hashchange']) window.addEventListener(name, sync);
    window.navigation?.addEventListener('currententrychange', sync);
    const context = (url, method) => {
        sync();
        try {
            const parsed = new URL(url, location.href);
            const videoId = parsed.pathname.match(/^\/v4\/watch\/lazy\/(sm[0-9]+)\/?$/)?.[1];
            return String(method).toUpperCase() === 'POST' && parsed.origin === 'https://nvapi.nicovideo.jp' &&
                videoId && videoId === route() ? { videoId, href, generation, order: ++order } : null;
        } catch { return null; }
    };
    const active = ctx => { sync(); return ctx && ctx.generation === generation && ctx.href === location.href && ctx.videoId === route(); };
    const textValue = value => typeof value === 'string' && value.length <= 10000 ? value : '';
    async function receive(ctx, read, status) {
        if (!active(ctx) || status !== 200) return;
        try {
            const json = JSON.parse(await read());
            if (!active(ctx) || json?.meta?.status !== 200 || !json.data ||
                (cached && cached.order > ctx.order)) return;
            // series.video.prev/nextは別動画なので転送しない。Cookie・本文・広告情報も転送しない。
            const owner = textValue(json.data.owner?.nickname);
            const series = textValue(json.data.series?.title);
            if (!owner && !series) return;
            cached = { videoId: ctx.videoId, href: ctx.href, order: ctx.order, owner, series };
            publish();
        } catch { /* ページ側の応答処理を妨げない。 */ }
    }
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let ctx;
        try {
            const isRequest = typeof Request !== 'undefined' && input instanceof Request;
            ctx = context(isRequest ? input.url : input, init?.method ?? (isRequest ? input.method : 'GET'));
        } catch {}
        const result = Reflect.apply(originalFetch, this, arguments);
        if (ctx) result.then(response => {
            if (!active(ctx) || response.status !== 200) return;
            const copy = response.clone();
            return receive(ctx, () => copy.text(), response.status);
        }).catch(() => {});
        return result;
    };
    const requests = new WeakMap(), originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        const result = Reflect.apply(originalOpen, this, arguments);
        requests.set(this, { method, url });
        return result;
    };
    XMLHttpRequest.prototype.send = function() {
        const request = requests.get(this);
        const ctx = request && context(request.url, request.method);
        if (ctx) {
            const finish = () => {
                this.removeEventListener('loadend', finish);
                if (requests.get(this) !== request || !active(ctx)) return;
                receive(ctx, () => this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText, this.status);
            };
            this.addEventListener('loadend', finish);
            try { return Reflect.apply(originalSend, this, arguments); }
            catch (error) { this.removeEventListener('loadend', finish); throw error; }
        }
        return Reflect.apply(originalSend, this, arguments);
    };
    window.postMessage({ channel, type: 'ready' }, location.origin);
})();

// ページ側では通信の複製だけを担当し、保存と設定の判断は拡張側で行う。
(() => {
    if (globalThis.chrome?.runtime?.id) return;
    const channel = "nico-downloader-comments-v1";
    let enabled = false;
    let client = "";
    let revision = 0;
    let requestOrder = 0;
    const route = () => location.pathname.match(/^\/(?:watch|shorts)\/([^/?#]+)\/?$/)?.[1] || "";
    const post = (data) => window.postMessage({ channel, client, ...data }, location.origin);
    window.addEventListener("message", (event) => {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin || data?.channel !== channel || data.type !== "configure") return;
        if (typeof data.client !== "string") return;
        enabled = data.enabled === true;
        client = data.client;
        revision++;
    });
    const matches = (url, method) => {
        try {
            const parsed = new URL(url, location.href);
            return method.toUpperCase() === "POST" && parsed.origin === "https://public.nvcomment.nicovideo.jp" &&
                parsed.pathname === "/v1/threads" && parsed.searchParams.get("pc") === "1";
        } catch { return false; }
    };
    const context = () => enabled && route() ? { videoId: route(), revision, client, requestOrder: ++requestOrder } : null;
    const active = (ctx) => ctx && enabled && ctx.revision === revision && ctx.videoId === route();
    async function receive(ctx, readResponse, status) {
        if (!active(ctx)) return;
        try {
            if (status < 200 || status >= 300) throw new Error("HTTP " + status);
            const text = await readResponse();
            if (!active(ctx)) return;
            const json = JSON.parse(text);
            if (!Array.isArray(json?.data?.threads) || (json.meta?.status != null && json.meta.status !== 200)) throw new Error("コメントJSONの形式が不正です");
            // レスポンスと取得時の動画番号だけを渡す。リクエスト本文は読まない。
            post({ type: "response", videoId: ctx.videoId, requestOrder: ctx.requestOrder, text });
        } catch (error) {
            if (active(ctx)) post({ type: "error", videoId: ctx.videoId, message: String(error.message) });
        }
    }
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        const ctx = context();
        let capture = false;
        try {
            const isRequest = typeof Request !== "undefined" && input instanceof Request;
            capture = ctx && matches(isRequest ? input.url : input, String(init?.method ?? (isRequest ? input.method : "GET")));
        } catch { capture = false; }
        const result = Reflect.apply(originalFetch, this, arguments);
        try {
            if (capture) {
                post({ type: "request", videoId: ctx.videoId, requestOrder: ctx.requestOrder });
                result.then((response) => {
                    if (!active(ctx)) return;
                    const copy = response.clone();
                    return receive(ctx, () => copy.text(), response.status);
                }).catch(() => {
                    if (active(ctx)) post({ type: "error", videoId: ctx.videoId, message: "fetch通信に失敗しました" });
                });
            }
        } catch { /* ページのfetchの戻り値・例外を変更しない。 */ }
        return result;
    };
    const requests = new WeakMap();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        const result = Reflect.apply(originalOpen, this, arguments);
        requests.set(this, { method: String(method), url });
        return result;
    };
    XMLHttpRequest.prototype.send = function (body) {
        const request = requests.get(this);
        const ctx = context();
        if (ctx && request && matches(request.url, request.method)) {
            post({ type: "request", videoId: ctx.videoId, requestOrder: ctx.requestOrder });
            const finish = () => {
                this.removeEventListener("loadend", finish);
                if (requests.get(this) !== request || !active(ctx)) return;
                try {
                    const text = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
                    receive(ctx, () => text, this.status);
                } catch { post({ type: "error", videoId: ctx.videoId, message: "XHRレスポンスを読み取れませんでした" }); }
            };
            this.addEventListener("loadend", finish);
            try { return Reflect.apply(originalSend, this, arguments); }
            catch (error) { this.removeEventListener("loadend", finish); throw error; }
        }
        return Reflect.apply(originalSend, this, arguments);
    };
    post({ type: "ready" });
})();


})();
