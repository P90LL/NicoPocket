export type Quality = 'best' | 'limit160' | 'limit128';

const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350];

/** Measure encoded AAC payload, excluding ADTS headers, against the stream duration. */
export function inspectAdts(bytes: Uint8Array): { bitrate: number; duration: number } {
  if (!(bytes instanceof Uint8Array)) throw new Error('AAC入力が正しくありません');
  let payload = 0, samples = 0, sampleRate: number | undefined;
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 7 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) {
      throw new Error('AAC ADTSフレームが正しくありません');
    }
    const rate = sampleRates[(bytes[offset + 2] & 0x3c) >> 2];
    const header = bytes[offset + 1] & 1 ? 7 : 9;
    const length = ((bytes[offset + 3] & 3) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
    if (!rate || sampleRate !== undefined && sampleRate !== rate || length <= header || offset + length > bytes.length) {
      throw new Error('AAC ADTSフレームの長さが正しくありません');
    }
    sampleRate = rate;
    payload += length - header;
    samples += 1024 * ((bytes[offset + 6] & 3) + 1);
    offset += length;
  }
  if (!sampleRate || !samples) throw new Error('AAC ADTSフレームがありません');
  return { bitrate: payload * 8 * sampleRate / samples, duration: samples / sampleRate };
}

export function measureAdtsBitrate(bytes: Uint8Array): number {
  return inspectAdts(bytes).bitrate;
}

export function compressionTarget(quality: Quality, sourceBitrate: number): 128000 | 160000 | undefined {
  if (!Number.isFinite(sourceBitrate) || sourceBitrate <= 0) throw new Error('元音声のビットレートが正しくありません');
  if (quality === 'best') return undefined;
  if (quality !== 'limit160' && quality !== 'limit128') throw new Error('音質設定が正しくありません');
  const cap = quality === 'limit160' ? 160_000 : 128_000;
  return sourceBitrate > cap ? cap : undefined;
}
