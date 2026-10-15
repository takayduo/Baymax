// Sample-free, deterministic sound synthesis using only Node built-ins.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const recipes = require('./sounds/recipes.cjs');
const root = path.resolve(__dirname, '..');
const SAMPLE_RATE = 48000;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

function randomFor(name) {
  let state = crypto.createHash('sha256').update('puff-soft-v1:' + name).digest().readUInt32LE(0) || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
}

function synthesize(recipe) {
  const samples = new Float64Array(Math.round(recipe.duration * SAMPLE_RATE));
  recipe.layers.forEach((layer, layerIndex) => {
    const start = Math.round(layer.at * SAMPLE_RATE), length = Math.round(layer.length * SAMPLE_RATE);
    const random = randomFor(recipe.name + ':' + layerIndex);
    const alpha = 1 - Math.exp(-2 * Math.PI * (layer.cutoff || 1100) / SAMPLE_RATE);
    let phase = 0, noise = 0;
    for (let i = 0; i < length && start + i < samples.length; i++) {
      const t = i / SAMPLE_RATE, u = i / Math.max(1, length - 1);
      // Smooth edges and a restrained decay avoid abrupt clicks or long ringing tails.
      const attack = Math.min(.018, layer.length * .22);
      const release = layer.length * (layer.kind === 'air' ? .65 : .48);
      const envelope = smooth(t / attack) * smooth((layer.length - t) / release) * Math.exp(-1.9 * u);
      let value;
      if (layer.kind === 'air') {
        noise += alpha * (random() - noise);
        value = noise;
      } else {
        const frequency = layer.from * Math.pow(layer.to / layer.from, smooth(u))
          * (1 + (layer.bend || 0) * Math.sin(Math.PI * u))
          * (1 + (layer.wobble || 0) * Math.sin(2 * Math.PI * (layer.wobbleHz || 5) * t));
        phase += 2 * Math.PI * frequency / SAMPLE_RATE;
        value = Math.sin(phase) + .10 * Math.sin(2 * phase) + .018 * Math.sin(3 * phase);
        if (layer.bell) value += .055 * Math.sin(2.73 * phase) * Math.exp(-5 * u);
      }
      samples[start + i] += value * envelope * layer.gain;
    }
  });
  // Remove DC and taper the whole clip, including any overlapping layers.
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (samples[i] - mean) * smooth(i / (SAMPLE_RATE * .008))
      * smooth((samples.length - 1 - i) / (SAMPLE_RATE * .012));
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (!peak) throw new Error('Empty synthesis: ' + recipe.name);
  return Int16Array.from(samples, value => Math.round(value * recipe.peak / peak * 32767));
}

function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24); bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(samples[i], 44 + i * 2);
  return bytes;
}

function makePack() {
  // Hashes document replacement only; no inherited audio is an input to synthesis.
  const replaced = JSON.parse(fs.readFileSync(path.join(__dirname, 'sounds/replaced-hashes.json'), 'utf8').replace(/^\uFEFF/, ''));
  const assets = recipes.map(recipe => {
    const samples = synthesize(recipe), bytes = wav(samples);
    return { recipe, samples, bytes, file: recipe.name + '.wav', sha256: sha256(bytes) };
  });
  const manifest = {
    pack: 'puff-soft-v1', version: 1, authoredOn: '2026-10-15',
    provenance: 'Newly synthesized for this project from independently authored waveform and seeded-noise recipes. No external samples, sampled voices, or copied melodies.',
    artwork: 'Unchanged; confirmed original by the project owner.',
    generator: 'scripts/generate-sounds.cjs', recipes: 'scripts/sounds/recipes.cjs',
    format: { encoding: 'PCM signed 16-bit little-endian', channels: 1, sampleRate: SAMPLE_RATE },
    sounds: assets.map(({ recipe, samples, bytes, file, sha256 }) => ({
      name: recipe.name, file, description: recipe.description,
      durationSeconds: samples.length / SAMPLE_RATE, peakLimit: recipe.peak,
      bytes: bytes.length, sha256, replacedSha256: replaced[file],
    })),
  };
  return { assets, manifest };
}

function generate(check = false) {
  const { assets, manifest } = makePack();
  const files = assets.map(asset => [path.join(root, 'public/sounds', asset.file), asset.bytes]);
  files.push([path.join(root, 'public/sounds/manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]);
  const preview = fs.readFileSync(path.join(__dirname, 'sounds/preview-template.html'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace('__SOUND_MANIFEST__', JSON.stringify(manifest.sounds));
  files.push([path.join(root, 'docs/sounds-preview.html'), Buffer.from(preview)]);
  const changed = [];
  for (const [file, bytes] of files) {
    if (check) {
      const actual = fs.existsSync(file) ? fs.readFileSync(file) : null;
      const matches = actual && (file.endsWith('.wav') ? actual.equals(bytes)
        : actual.toString('utf8').replace(/\r\n/g, '\n') === bytes.toString('utf8'));
      if (!matches) changed.push(path.relative(root, file));
    }
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  }
  if (changed.length) throw new Error('Sound assets differ from recipes: ' + changed.join(', '));
  if (!check) {
    const gap = Math.round(.45 * SAMPLE_RATE);
    const montage = new Int16Array(assets.reduce((sum, a) => sum + a.samples.length + gap, 0));
    const cues = []; let offset = 0;
    for (const asset of assets) {
      cues.push({ name: asset.recipe.name, startsAtSeconds: offset / SAMPLE_RATE });
      montage.set(asset.samples, offset); offset += asset.samples.length + gap;
    }
    const output = path.join(root, 'audit/sound-preview'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'all-sounds.wav'), wav(montage));
    fs.writeFileSync(path.join(output, 'cue-sheet.json'), JSON.stringify(cues, null, 2) + '\n');
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${assets.length} original WAVs (48 kHz / mono / 16-bit).`);
}

module.exports = { SAMPLE_RATE, recipes, synthesize, wav, makePack, sha256, generate };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/generate-sounds.cjs [--check]');
    generate(args.includes('--check'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
