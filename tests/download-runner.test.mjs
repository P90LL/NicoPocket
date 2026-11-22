import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load-script.mjs';

function createRunnerEnv({ urlToM3u8Error = null } = {}) {
    let downloaderInstances = 0;
    let downloadingResetCount = 0;
    let isDownloading = false;

    class MockNicoDownloaderClass {
        constructor() {
            downloaderInstances++;
            this.MatchingSMIDArray = /sm[0-9]+/;
            this.M3u8 = {
                AudioM3u8URL: 'https://delivery.domand.nicovideo.jp/audio.m3u8',
                VideoM3u8URL: 'https://delivery.domand.nicovideo.jp/video.m3u8',
                AudioBody: '#EXTM3U',
                VideoBody: '#EXTM3U',
                FirstBody: '#EXTM3U',
            };
            this.M3u8Class = {
                ReplaceURLToM3u8s: body => body,
                MakeTSFilename: () => 'segment.ts',
                MakeURLListToTSURLs: () => [],
                MakeTSFileNameListtoArray: () => [],
            };
        }
        VideoDownloadingCheck() {
            return isDownloading;
        }
        VideoDownloadNameMake(sm, title) {
            return `${title}_${sm}`;
        }
        VideoTitleElementCheck() {}
        VideoLoadedCheck() {
            return false;
        }
        ButtonTextWrite() {}
        CheckBeforeDownload() {
            return true;
        }
        MasterURLGet() {
            return 'https://delivery.domand.nicovideo.jp/hlsbid/master.m3u8';
        }
        async URLToM3u8Set() {
            isDownloading = true;
            if (urlToM3u8Error) throw urlToM3u8Error;
        }
        M3u8ToAudioAndVideoUrlSet() {
            return true;
        }
        VideoDownloadingReset() {
            isDownloading = false;
            downloadingResetCount++;
        }
        VideoLoadedSMIDSet() {}
    }

    class MockNicovideoClass {
        constructor() {
            this.video_sm = '';
            this.video_title = '';
            this.video_name = '';
        }
        CheckNicovideoWatchURL() {
            return true;
        }
        VideoSmGet() {
            return 'sm12345';
        }
        async SetAllFromVideoSm() {
            this.video_title = 'テスト動画';
        }
        GetPageTitle() {
            return 'テスト動画';
        }
    }

    const ownedJobs = new Set();
    const { exported } = loadScript('nico_downloader/pocket/download-runner.js', {
        globals: {
            setInterval: () => 1,
            clearInterval: () => {},
            DebugPrint: () => {},
            NicoPocketUI: { placeButton: () => {} },
            NicoPocketAAC: {
                owns: job => ownedJobs.has(job),
            },
            NicoDownloaderClass: MockNicoDownloaderClass,
            NicovideoClass: MockNicovideoClass,
            DownEncoder: () => {},
        },
        exportNames: ['VideoDown', 'MovieDownload_domand'],
    });

    return {
        VideoDown: exported.VideoDown,
        ownedJobs,
        getDownloaderInstances: () => downloaderInstances,
        getDownloadingResetCount: () => downloadingResetCount,
        getIsDownloading: () => isDownloading,
    };
}

test('VideoDown rejects requests without nicopocket ownership before creating downloader instances', async () => {
    const env = createRunnerEnv();
    const unownedJob = { videoId: 'sm12345', title: 'テスト動画' };

    assert.equal(await env.VideoDown(null), false);
    assert.equal(
        await env.VideoDown({ outputOwner: 'other', job: unownedJob, isCurrent: () => true }),
        false
    );
    assert.equal(
        await env.VideoDown({ outputOwner: 'nicopocket', job: unownedJob, isCurrent: () => true }),
        false
    );
    assert.equal(env.getDownloaderInstances(), 0);
});

test('VideoDown always calls VideoDownloadingReset via finally even when MovieDownload_domand rejects', async () => {
    const env = createRunnerEnv({ urlToM3u8Error: new Error('HLS fetch failure') });
    const job = {
        videoId: 'sm12345',
        title: 'テスト動画',
        metadata: {},
    };
    env.ownedJobs.add(job);

    const started = await env.VideoDown({
        outputOwner: 'nicopocket',
        job,
        isCurrent: () => true,
    });
    assert.equal(started, true);

    // Wait a microtask tick for the inner promise chain (.then -> MovieDownload_domand -> .catch -> .finally)
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(env.getDownloadingResetCount(), 1);
    assert.equal(env.getIsDownloading(), false);
});
