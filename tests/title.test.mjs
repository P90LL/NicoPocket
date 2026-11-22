import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load-script.mjs';

const { exported } = loadScript('nico_downloader/pocket/title.js', {
    exportNames: ['NicoPocketTitle'],
});
const { NicoPocketTitle } = exported;

test('NicoPocketTitle.normalize replaces forbidden filename characters and control chars', () => {
    const raw = 'A\\B/C:D*E?F"G<H>I|J\u0000K\u001fL\u007fM';
    assert.equal(NicoPocketTitle.normalize(raw), 'A_B_C_D_E_F_G_H_I_J_K_L_M');
});

test('NicoPocketTitle.normalize collapses consecutive whitespace and trims trailing dots/spaces', () => {
    assert.equal(NicoPocketTitle.normalize('  初音ミク   \u3000  テスト曲  ... .  '), '初音ミク テスト曲');
    assert.equal(NicoPocketTitle.normalize('曲名\t\nサブタイトル'), '曲名__サブタイトル');
});

test('NicoPocketTitle.normalize truncates at 180 code points and removes trailing dots/spaces after truncation', () => {
    const longText = 'あ'.repeat(179) + '.extra';
    const normalized = NicoPocketTitle.normalize(longText);
    assert.equal(Array.from(normalized).length, 179);
    assert.equal(normalized, 'あ'.repeat(179));

    const exact185 = 'A'.repeat(200);
    assert.equal(NicoPocketTitle.normalize(exact185).length, 180);
});

test('NicoPocketTitle.normalize prefixes Windows reserved names with underscore', () => {
    assert.equal(NicoPocketTitle.normalize('CON'), '_CON');
    assert.equal(NicoPocketTitle.normalize('prn.txt'), '_prn.txt');
    assert.equal(NicoPocketTitle.normalize('COM1'), '_COM1');
    assert.equal(NicoPocketTitle.normalize('lpt9.m4a'), '_lpt9.m4a');
    assert.equal(NicoPocketTitle.normalize('aux'), '_aux');
    assert.equal(NicoPocketTitle.normalize('NUL.audio'), '_NUL.audio');

    // Non-reserved names starting with similar prefixes stay unchanged
    assert.equal(NicoPocketTitle.normalize('CONCERT'), 'CONCERT');
    assert.equal(NicoPocketTitle.normalize('COM10'), 'COM10');
});

test('NicoPocketTitle.normalize falls back when value is empty or only dots/spaces', () => {
    assert.equal(NicoPocketTitle.normalize('', 'sm9'), 'sm9');
    assert.equal(NicoPocketTitle.normalize('   ...   ', 'sm12345'), 'sm12345');
    assert.equal(NicoPocketTitle.normalize('', ''), 'untitled');
    assert.equal(NicoPocketTitle.normalize(null, undefined), 'untitled');
});
