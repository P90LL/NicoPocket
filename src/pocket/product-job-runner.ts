import { JobRunner } from './job-runner.js';
import { createJobStatePort } from './job-state-client.js';
import { acquireWatchJobAudio } from './watch-audio-client.js';
import { processJobMedia } from './job-media.js';
import { saveJobMediaWithAllocatedNames } from './job-save.js';
import { JobImageDatabase } from './job-image-database.js';
import { createSaveRecoveryLifecycle } from './save-recovery-client.js';
import { ResourceSlots } from './resource-slots.js';

// 取得元・変換・Chrome保存・復旧記録を本体のジョブ処理へ接続する。
// UI側で明示した取得上限と高負荷枠を使う。
export function createProductJobRunner(options: { concurrency: number; mediaSlots: number;
  maxInputBytes: number }, images = new JobImageDatabase()): JobRunner {
  if (!Number.isSafeInteger(options.maxInputBytes) || options.maxInputBytes < 1) {
    throw new Error('取得入力の上限が正しくありません。');
  }
  const inputs = new ResourceSlots(options.mediaSlots);
  return new JobRunner({
    state: createJobStatePort(),
    acquire: async (job, signal) => {
      const release = await inputs.acquire(signal);
      try {
        signal.throwIfAborted();
        const audio = await acquireWatchJobAudio(job, signal, options.maxInputBytes);
        return { ...audio, async dispose() {
          try { await audio.dispose(); } finally { release(); }
        } };
      } catch (error) { release(); throw error; }
    },
    process: (job, source, signal, onStage) => processJobMedia(job, source, images, signal, onStage),
    save: (job, output, signal) => saveJobMediaWithAllocatedNames(job, output, signal,
      createSaveRecoveryLifecycle(job.videoId))
  }, { concurrency: options.concurrency, mediaSlots: options.mediaSlots });
}
