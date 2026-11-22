import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load-script.mjs';

const { exported } = loadScripts(
    ['nico_downloader/pocket/policy.js', 'nico_downloader/pocket/audio-quality.js'],
    { exportNames: ['NicoPocketPolicy', 'NicoPocketAudioQuality'] }
);
const { NicoPocketPolicy, NicoPocketAudioQuality } = exported;

test('NicoPocketPolicy defines frozen standard bitrate and limits', () => {
    assert.equal(Object.isFrozen(NicoPocketPolicy), true);
    assert.equal(NicoPocketPolicy.standardBitrateKbps, 192);
});

test('NicoPocketAudioQuality.outputArgs returns copy or 192k AAC-LC re-encode appropriately', () => {
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('standard', 128), ['-c:a', 'copy']);
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('standard', 192), ['-c:a', 'copy']);
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('standard', 256), [
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-profile:a',
        'aac_low',
    ]);
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('high', 192), ['-c:a', 'copy']);
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('high', 256), ['-c:a', 'copy']);
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('standard', null), ['-c:a', 'copy']);
    assert.deepEqual(NicoPocketAudioQuality.outputArgs('standard', Number.NaN), ['-c:a', 'copy']);
});

test('NicoPocketAudioQuality.select chooses 192kbps or below for standard, and highest for high', () => {
    const renditions = [
        { TYPE: 'AUDIO', ID: 'audio-aac-128kbps', URI: 'https://example.com/hls/audio-aac-128kbps/playlist.m3u8' },
        { TYPE: 'AUDIO', ID: 'audio-aac-192kbps', URI: 'https://example.com/hls/audio-aac-192kbps/playlist.m3u8' },
        { TYPE: 'AUDIO', ID: 'audio-aac-256kbps', URI: 'https://example.com/hls/audio-aac-256kbps/playlist.m3u8' },
    ];
    const qualities = [
        { id: 'audio-aac-128kbps', available: true, bitrate: 128000 },
        { id: 'audio-aac-192kbps', available: true, bitrate: 192000 },
        { id: 'audio-aac-256kbps', available: true, bitrate: 256000 },
    ];

    const std = NicoPocketAudioQuality.select(renditions, qualities, 'standard');
    assert.equal(std?.id, 'audio-aac-192kbps');
    assert.equal(std?.bitrate, 192);

    const high = NicoPocketAudioQuality.select(renditions, qualities, 'high');
    assert.equal(high?.id, 'audio-aac-256kbps');
    assert.equal(high?.bitrate, 256);
});

test('NicoPocketAudioQuality.select falls back to >192kbps in standard mode when no <=192kbps rendition exists', () => {
    const renditions = [
        { TYPE: 'AUDIO', ID: 'audio-aac-256kbps', URI: 'https://example.com/hls/audio-aac-256kbps/playlist.m3u8' },
    ];
    const qualities = [{ id: 'audio-aac-256kbps', available: true, bitrate: 256000 }];

    const selected = NicoPocketAudioQuality.select(renditions, qualities, 'standard');
    assert.equal(selected?.id, 'audio-aac-256kbps');
    assert.equal(selected?.bitrate, 256);
});

test('NicoPocketAudioQuality.select excludes unavailable qualities and returns null when unrankable candidates exist', () => {
    const renditions = [
        { TYPE: 'AUDIO', ID: 'audio-aac-192kbps', URI: 'https://example.com/hls/audio-aac-192kbps/playlist.m3u8' },
        { TYPE: 'AUDIO', ID: 'audio-aac-256kbps', URI: 'https://example.com/hls/audio-aac-256kbps/playlist.m3u8' },
    ];
    const qualities = [
        { id: 'audio-aac-192kbps', available: true, bitrate: 192000 },
        { id: 'audio-aac-256kbps', available: false, bitrate: 256000 },
    ];

    const high = NicoPocketAudioQuality.select(renditions, qualities, 'high');
    assert.equal(high?.id, 'audio-aac-192kbps');

    // Mixed unrankable candidate returns null for safety
    const mixedRenditions = [
        ...renditions,
        { TYPE: 'AUDIO', ID: 'unknown-stream', URI: 'https://example.com/hls/unknown/playlist.m3u8' },
    ];
    assert.equal(NicoPocketAudioQuality.select(mixedRenditions, qualities, 'high'), null);
});
