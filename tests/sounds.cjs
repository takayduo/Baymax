const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makePack, sha256 } = require('../scripts/generate-sounds.cjs');
const root = path.resolve(__dirname, '..');
const { assets, manifest } = makePack();

test('All 28 sound events retain their filenames and have reproducible original replacements', () => {
  const source = fs.readFileSync(path.join(root, 'src/core/sound.ts'), 'utf8');
  const names = [...source.match(/SOUND_NAMES = \[([\s\S]*?)\]/)[1].matchAll(/"([a-z]+)"/g)].map(match => match[1]);
  assert.equal(names.length, 28);
  assert.deepEqual(assets.map(asset => asset.recipe.name), names);
  const folder = path.join(root, 'public/sounds');
  assert.deepEqual(fs.readdirSync(folder).filter(file => file.endsWith('.wav')).sort(), names.map(name => name + '.wav').sort());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')), manifest);
  const oldHashes = new Set(manifest.sounds.map(sound => sound.replacedSha256));
  for (const asset of assets) {
    const actual = fs.readFileSync(path.join(folder, asset.file));
    assert.deepEqual(actual, asset.bytes, asset.file + ' must match its deterministic recipe');
    assert.match(manifest.sounds.find(sound => sound.file === asset.file).replacedSha256, /^[a-f0-9]{64}$/);
    assert.ok(!oldHashes.has(sha256(actual)), asset.file + ' must not reuse any inherited recording');
  }
  assert.equal(new Set(assets.map(asset => asset.sha256)).size, 28, 'Each reaction has its own sound');
});

test('WAVs are valid short mono PCM with headroom, audible content and smooth boundaries', () => {
  for (const { file, bytes } of assets) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', file);
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
    assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 48000); assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40) + 44, bytes.length);
    const count = (bytes.length - 44) / 2;
    assert.ok(count / 48000 >= .07 && count / 48000 <= 1.3, file);
    let peak = 0, sum = 0, energy = 0, last = 0, jump = 0;
    for (let i = 0; i < count; i++) {
      const sample = bytes.readInt16LE(44 + i * 2) / 32768;
      peak = Math.max(peak, Math.abs(sample)); jump = Math.max(jump, Math.abs(sample - last));
      sum += sample; energy += sample * sample; last = sample;
    }
    assert.ok(peak > .15 && peak < .50, file + ' has conservative peak headroom');
    assert.ok(Math.sqrt(energy / count) > .025, file + ' contains audible signal');
    assert.ok(Math.abs(sum / count) < .002, file + ' avoids DC offset');
    assert.ok(jump < .15, file + ' avoids sample discontinuities');
    assert.equal(bytes.readInt16LE(44), 0, file + ' starts smoothly');
    assert.equal(bytes.readInt16LE(bytes.length - 2), 0, file + ' ends smoothly');
  }
});
