// End-to-end tests: a local mock gateway (http server) and the MCP server spawned over stdio. No network, no paid calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ezkielyna-audio-mcp.mjs');
const GOOD_KEY = 'sk-' + 'test-good-key-0001'; // built at runtime: no key-shaped string in the source
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(200, 1)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(100)]);

// Trimmed copy of the public /api/pricing shape (recorded 11 Nov 2026; descriptions shortened, one hidden id added for the filter test).
const PRICING = {
  success: true,
  group_ratio: { default: 1, free: 1, media: 1, premium: 1.5, pro: 3 },
  data: [
    { model_name: 'edge-tts', description: 'Microsoft Edge neural text-to-speech (OpenAI /v1/audio/speech). voice = Edge voice id (id-ID-GadisNeural, id-ID-ArdiNeural, en-US-AriaNeural, ...) or an OpenAI voice name. MP3 only, max 4096 characters. Priced per input character.', tags: 'TTS', quota_type: 0, model_ratio: 0.5, model_price: 0, completion_ratio: 1, enable_groups: ['default', 'member', 'premium', 'free', 'promo'], supported_endpoint_types: ['openai', 'openai-audio'] },
    { model_name: 'tts-kokoro', description: 'Kokoro text-to-speech; English, Japanese (no Indonesian). voice: af_heart, af_bella, am_adam. MP3/Opus/AAC/FLAC/WAV. Endpoint /v1/audio/speech (OpenAI format). Priced per input character.', tags: 'TTS', quota_type: 0, model_ratio: 3.5, model_price: 0, completion_ratio: 1, enable_groups: ['pro', 'default', 'member', 'premium'], supported_endpoint_types: ['openai', 'openai-audio'] },
    { model_name: 'tts-xai-v1', description: 'xAI text-to-speech v1, multilingual incl. Indonesian. voice: eve, ara, leo. MP3/WAV/PCM. Priced per input character.', tags: 'TTS', quota_type: 0, model_ratio: 18.75, model_price: 0, completion_ratio: 1, enable_groups: ['premium', 'pro', 'default'], supported_endpoint_types: ['openai', 'openai-audio'] },
    { model_name: 'whisper-large-v3', description: 'Whisper large-v3 speech-to-text, 99 languages incl. Indonesian. Priced per minute of audio.', tags: 'STT', quota_type: 0, model_ratio: 6, model_price: 0, completion_ratio: 1, enable_groups: ['default', 'member', 'premium', 'pro'], supported_endpoint_types: ['openai', 'openai-audio'] },
    { model_name: 'stt-xai-v1', description: 'xAI speech-to-text v1. Priced per minute of audio.', tags: 'STT', quota_type: 0, model_ratio: 1.89, model_price: 0, completion_ratio: 1, enable_groups: ['default', 'premium', 'pro'], supported_endpoint_types: ['openai', 'openai-audio'] },
    { model_name: 'deepseek-v4.1-flash', tags: 'Vision', quota_type: 0, model_ratio: 0.02, model_price: 0, completion_ratio: 4, enable_groups: ['default'], supported_endpoint_types: ['openai'] },
    { model_name: 'tts-demo-nsfw', tags: 'TTS', quota_type: 0, model_ratio: 1, model_price: 0, enable_groups: ['default'], supported_endpoint_types: ['openai-audio'] },
  ],
};

let gw;
let base;
const seen = [];
const children = [];
let tmp;

function json(res, status, v) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(v));
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezk-audio-mcp-'));
  fs.writeFileSync(path.join(tmp, 'note.ogg'), Buffer.concat([Buffer.from('OggS'), Buffer.alloc(500, 7)]));
  fs.writeFileSync(path.join(tmp, 'meeting.m4a'), Buffer.alloc(1000, 3));
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(tmp, 'empty.mp3'), '');
  fs.closeSync(fs.openSync(path.join(tmp, 'huge.wav'), 'w'));
  fs.truncateSync(path.join(tmp, 'huge.wav'), 26 * 1024 * 1024); // sparse: no real 26 MB written
  gw = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const rec = { method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'] || '' };
    seen.push(rec);
    if (req.url === '/api/pricing') return json(res, 200, PRICING);
    const key = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (key === 'sk-wrong-401') return json(res, 401, { error: { message: `invalid token ${key}` } });
    if (key === 'sk-broke-402') return json(res, 402, { error: { message: 'insufficient user quota' } });
    if (key === 'sk-group-503') return json(res, 503, { error: { message: 'no available channel for model edge-tts under group media' } });
    if (key !== GOOD_KEY) return json(res, 401, { error: { message: 'bad key' } });
    if (req.url === '/v1/models') return json(res, 200, { data: [{ id: 'edge-tts' }, { id: 'whisper-large-v3' }, { id: 'deepseek-v4.1-flash' }] });
    if (req.url === '/v1/audio/speech') {
      rec.json = JSON.parse(body.toString());
      const { model, input, response_format: fmt } = rec.json;
      if (input.includes('jsonreply')) return json(res, 200, { error: { message: 'voice not supported' } });
      if (input.includes('garbage')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(Buffer.from('<html>oops</html>')); }
      const wav = model !== 'edge-tts' && fmt === 'wav';
      res.writeHead(200, { 'Content-Type': wav ? 'audio/wav' : 'audio/mpeg' });
      return res.end(wav ? WAV : MP3);
    }
    if (req.url === '/v1/audio/transcriptions') {
      const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': rec.type }, body }).formData();
      rec.form = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
      rec.files = [...form.entries()].filter(([, v]) => typeof v !== 'string').map(([k, v]) => ({ field: k, name: v.name, type: v.type, size: v.size }));
      if (rec.form.response_format === 'srt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('1\n00:00:00,000 --> 00:00:02,000\nHalo semua\n'); }
      if (rec.form.model === 'plain-stt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('  plain transcript  '); }
      return json(res, 200, { text: ' Halo, ini catatan suara. ' });
    }
    json(res, 404, { error: { message: 'not found' } });
  });
  await new Promise(r => gw.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${gw.address().port}`;
});

after(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
  gw.closeAllConnections();
  gw.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function startMcp(extraEnv = {}) {
  const outDir = fs.mkdtempSync(path.join(tmp, 'out-'));
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, HOME: tmp, EZKIELYNA_API_KEY: GOOD_KEY, EZKIELYNA_BASE_URL: `${base}/v1`, EZKIELYNA_AUDIO_DIR: outDir, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let buf = '';
  let stdout = '';
  let stderr = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.on('data', d => {
    stdout += d;
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  child.stderr.on('data', d => { stderr += d; });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
    waiting.set(id, m => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const stop = () => new Promise(r => { child.on('exit', r); child.stdin.end(); });
  return { request, notify, call, stop, outDir, logs: () => stdout + stderr };
}

async function initialized(env) {
  const mcp = startMcp(env);
  await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  mcp.notify('notifications/initialized');
  return mcp;
}

const textOf = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const savedPath = r => textOf(r).match(/Saved: (.+)/)[1].trim();
const last = url => seen.filter(s => s.url === url).at(-1);

test('handshake, ping, tools/list with schemas and annotations', async () => {
  const mcp = startMcp();
  const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.equal(init.result.serverInfo.name, 'ezkielyna-audio');
  assert.deepEqual((await mcp.request('ping')).result, {});
  const { tools } = (await mcp.request('tools/list', {})).result;
  assert.deepEqual(tools.map(t => t.name).sort(), ['list_audio_models', 'text_to_speech', 'transcribe_audio']);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
  }
  assert.deepEqual(tools.find(t => t.name === 'text_to_speech').inputSchema.properties.format.enum, ['mp3', 'wav']);
  assert.equal(tools.find(t => t.name === 'text_to_speech').annotations.destructiveHint, false);
  assert.equal((await mcp.request('nope')).error.code, -32601);
  assert.equal((await mcp.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  await mcp.stop();
});

test('text_to_speech: default model + Indonesian voice, saves MP3, never overwrites, sanitises names', async () => {
  const mcp = await initialized();
  const r = await mcp.call('text_to_speech', { text: 'Halo, selamat datang di toko kami.', filename: '../../etc/sapaan toko!.wav' });
  assert.ok(!r.isError, textOf(r));
  assert.deepEqual(last('/v1/audio/speech').json, { model: 'edge-tts', input: 'Halo, selamat datang di toko kami.', voice: 'id-ID-GadisNeural', response_format: 'mp3' });
  assert.equal(last('/v1/audio/speech').auth, `Bearer ${GOOD_KEY}`);
  const p1 = savedPath(r);
  assert.equal(path.dirname(p1), fs.realpathSync(mcp.outDir));
  assert.equal(path.basename(p1), 'sapaan-toko.mp3');
  assert.deepEqual(fs.readFileSync(p1), MP3);
  // 34 characters x $1 per 1M characters
  assert.match(textOf(r), /≈ \$0\.000034 \(\$1 per 1M characters/);
  assert.match(textOf(r), /Session: 1\/30/);
  const r2 = await mcp.call('text_to_speech', { text: 'lagi', filename: 'sapaan toko', voice: 'id-ID-ArdiNeural' });
  assert.equal(path.basename(savedPath(r2)), 'sapaan-toko-1.mp3');
  assert.equal(last('/v1/audio/speech').json.voice, 'id-ID-ArdiNeural');
  const r3 = await mcp.call('text_to_speech', { text: 'tanpa nama' });
  assert.match(path.basename(savedPath(r3)), /^ezk-tts-edge-tts-\d{8}-\d{6}\.mp3$/);
  await mcp.stop();
  assert.ok(!mcp.logs().includes(GOOD_KEY));
});

test('text_to_speech: wav, per-model default voices, and an honest note when the model only returns MP3', async () => {
  const mcp = await initialized();
  const w = await mcp.call('text_to_speech', { text: 'hello', model: 'tts-kokoro', format: 'wav' });
  assert.ok(!w.isError, textOf(w));
  assert.match(savedPath(w), /\.wav$/);
  assert.deepEqual(last('/v1/audio/speech').json, { model: 'tts-kokoro', input: 'hello', voice: 'af_heart', response_format: 'wav' });
  const e = await mcp.call('text_to_speech', { text: 'halo', format: 'wav' });
  assert.match(savedPath(e), /\.mp3$/);
  assert.match(textOf(e), /edge-tts returned MP3, not WAV/);
  await mcp.call('text_to_speech', { text: 'x', model: 'some-new-tts' });
  assert.equal(last('/v1/audio/speech').json.voice, 'alloy');
  await mcp.stop();
});

test('text_to_speech: input checks happen before sending; non-audio answers are refused', async () => {
  const mcp = await initialized({ EZKIELYNA_MAX_CALLS: '1' });
  const before = seen.length;
  const long = await mcp.call('text_to_speech', { text: 'a'.repeat(4001) });
  assert.match(textOf(long), /max 4000/);
  assert.match(textOf(await mcp.call('text_to_speech', { text: '' })), /is required/);
  assert.match(textOf(await mcp.call('text_to_speech', { text: 'x', voice: 'bad;voice' })), /Invalid voice/);
  assert.match(textOf(await mcp.call('text_to_speech', { text: 'x', format: 'ogg' })), /mp3 atau\/or wav/);
  assert.match(textOf(await mcp.call('text_to_speech', { text: 'x', model: 'tts-demo-nsfw' })), /not available through this MCP/);
  assert.equal(seen.length, before, 'nothing was sent');
  const j = await mcp.call('text_to_speech', { text: 'jsonreply' });
  assert.ok(j.isError);
  assert.match(textOf(j), /did not return audio.*voice not supported/);
  // The refused JSON answer gave the only slot back, so this call still runs (and is not audio either).
  const g = await mcp.call('text_to_speech', { text: 'garbage' });
  assert.ok(g.isError);
  assert.match(textOf(g), /not a known audio file/);
  assert.equal(fs.readdirSync(mcp.outDir).length, 0, 'nothing saved');
  await mcp.stop();
});

test('transcribe_audio sends multipart with model, language and prompt; returns the text', async () => {
  const mcp = await initialized();
  const r = await mcp.call('transcribe_audio', { file: path.join(tmp, 'note.ogg'), language: 'ID', prompt: 'Ezkielyna, QRIS' });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /^Halo, ini catatan suara\.\n/);
  assert.match(textOf(r), /Model: whisper-large-v3 \| language: id/);
  assert.match(textOf(r), /\$12 per 1M audio tokens/);
  const req = last('/v1/audio/transcriptions');
  assert.match(req.type, /^multipart\/form-data/);
  assert.deepEqual(req.form, { model: 'whisper-large-v3', response_format: 'json', language: 'id', prompt: 'Ezkielyna, QRIS' });
  assert.deepEqual(req.files, [{ field: 'file', name: 'note.ogg', type: 'audio/ogg', size: 504 }]);
  const srt = await mcp.call('transcribe_audio', { file: path.join(tmp, 'meeting.m4a'), response_format: 'srt', model: 'stt-xai-v1' });
  assert.match(textOf(srt), /^1\n00:00:00,000 --> 00:00:02,000\nHalo semua/);
  assert.equal(last('/v1/audio/transcriptions').form.response_format, 'srt');
  assert.equal(last('/v1/audio/transcriptions').files[0].type, 'audio/mp4');
  const plain = await mcp.call('transcribe_audio', { file: path.join(tmp, 'note.ogg'), model: 'plain-stt' });
  assert.match(textOf(plain), /^plain transcript\n/);
  // A bare file name is looked up in the audio folder too (e.g. a file text_to_speech just saved).
  const tts = await mcp.call('text_to_speech', { text: 'halo', filename: 'balik' });
  const back = await mcp.call('transcribe_audio', { file: path.basename(savedPath(tts)) });
  assert.ok(!back.isError, textOf(back));
  await mcp.stop();
});

test('transcribe_audio rejects bad files before sending', async () => {
  const mcp = await initialized();
  const before = seen.length;
  const cases = [
    [{ file: path.join(tmp, 'notes.txt') }, /Unsupported file type/],
    [{ file: path.join(tmp, 'missing.mp3') }, /File not found/],
    [{ file: path.join(tmp, 'empty.mp3') }, /Empty file/],
    [{ file: path.join(tmp, 'huge.wav') }, /larger than 25 MB/],
    [{ file: 'https://example.com/a.mp3' }, /not a URL/],
    [{ file: '' }, /is required/],
    [{ file: path.join(tmp, 'note.ogg'), language: 'indonesian' }, /ISO-639-1/],
    [{ file: path.join(tmp, 'note.ogg'), response_format: 'verbose_json' }, /response_format/],
    [{ file: path.join(tmp, 'note.ogg'), prompt: 'x'.repeat(501) }, /max 500/],
  ];
  for (const [args, re] of cases) {
    const r = await mcp.call('transcribe_audio', args);
    assert.ok(r.isError, JSON.stringify(args).slice(0, 80));
    assert.match(textOf(r), re);
  }
  assert.equal(seen.length, before, 'nothing was sent');
  await mcp.stop();
});

test('session cap stops paid calls; refused calls give the slot back; key never shown', async () => {
  const mcp = await initialized({ EZKIELYNA_MAX_CALLS: '1' });
  assert.ok(!(await mcp.call('text_to_speech', { text: 'satu' })).isError);
  const before = seen.length;
  const r = await mcp.call('transcribe_audio', { file: path.join(tmp, 'note.ogg') });
  assert.ok(r.isError);
  assert.match(textOf(r), /EZKIELYNA_MAX_CALLS/);
  assert.equal(seen.slice(before).filter(s => s.url.startsWith('/v1/audio')).length, 0);
  assert.ok(!(await mcp.call('list_audio_models', {})).isError, 'free tool still works');
  await mcp.stop();
  for (const [key, re] of [['sk-wrong-401', /Wrong or inactive API key/], ['sk-broke-402', /Insufficient API balance/], ['sk-group-503', /cannot use this model.*group Auto/]]) {
    const m = await initialized({ EZKIELYNA_API_KEY: key, EZKIELYNA_MAX_CALLS: '1' });
    const a = await m.call('text_to_speech', { text: 'x' });
    assert.ok(a.isError, key);
    assert.match(textOf(a), re);
    const b = await m.call('transcribe_audio', { file: path.join(tmp, 'note.ogg') });
    assert.doesNotMatch(textOf(b), /EZKIELYNA_MAX_CALLS/, 'refused call gave its slot back');
    await m.stop();
    assert.ok(!m.logs().includes(key), `key ${key} leaked`);
  }
});

test('list_audio_models shows TTS/STT prices, groups, voices; marks what the key can use', async () => {
  const anon = await initialized({ EZKIELYNA_API_KEY: '' });
  const r = await anon.call('list_audio_models', {});
  assert.ok(!r.isError, textOf(r));
  const t = textOf(r);
  assert.match(t, /- edge-tts: \$1 per 1M characters \| groups: Standard, Premium, Hemat \| voices: Edge voice id \(id-ID-GadisNeural, id-ID-ArdiNeural, en-US-AriaNeural, \.\.\.\) or an OpenAI voice name \| formats: MP3 only \| default voice: id-ID-GadisNeural/);
  assert.match(t, /- tts-kokoro: \$7 per 1M characters \| groups: Pro, Standard, Premium \| voices: af_heart, af_bella, am_adam \| formats: MP3\/Opus\/AAC\/FLAC\/WAV/);
  assert.match(t, /- stt-xai-v1: \$3\.78 per 1M audio tokens/);
  assert.match(t, /- whisper-large-v3: \$12 per 1M audio tokens/);
  assert.ok(t.indexOf('edge-tts') < t.indexOf('tts-kokoro') && t.indexOf('tts-kokoro') < t.indexOf('tts-xai-v1'), 'sorted by price');
  assert.ok(t.indexOf('tts-xai-v1') < t.indexOf('Speech to text'));
  assert.doesNotMatch(t, /nsfw|deepseek|your key/);
  await anon.stop();
  const mcp = await initialized();
  const k = textOf(await mcp.call('list_audio_models', {}));
  assert.match(k, /- edge-tts: .*your key: OK/);
  assert.match(k, /- tts-kokoro: .*your key: tidak \/ no/);
  await mcp.stop();
});

test('missing key gives setup help instead of crashing', async () => {
  const mcp = await initialized({ EZKIELYNA_API_KEY: '' });
  for (const [name, args] of [['text_to_speech', { text: 'x' }], ['transcribe_audio', { file: path.join(tmp, 'note.ogg') }]]) {
    const r = await mcp.call(name, args);
    assert.ok(r.isError);
    assert.match(textOf(r), /EZKIELYNA_API_KEY/);
  }
  await mcp.stop();
});
