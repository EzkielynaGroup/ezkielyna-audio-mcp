#!/usr/bin/env node
// Ezkielyna Audio MCP: text to speech (saved as local audio files) and speech to text from local audio files through the
// Ezkielyna API, from Claude Desktop, Claude Code, Cursor, OpenCode or any MCP client.
// One file, no dependencies, Node >= 18. MCP over stdio (newline-delimited JSON-RPC). Logs go to stderr only; stdout
// carries protocol messages. The API key is never printed.
//
// Env:
//   EZKIELYNA_API_KEY      required for text_to_speech / transcribe_audio (a key whose group lists the audio models; Auto covers them)
//   EZKIELYNA_BASE_URL     default https://api.ezkielyna.store/v1
//   EZKIELYNA_AUDIO_DIR    where speech files are saved, default ~/Music/Ezkielyna (created if missing)
//   EZKIELYNA_MAX_CALLS    paid calls per session (per MCP process), default 30
//   EZKIELYNA_TIMEOUT_MS   request timeout, default 300000
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';
const UTM = '?utm_source=mcp&utm_medium=tool&utm_campaign=ezkielyna-audio-mcp';
const BUY_URL = 'https://ezkielyna.store/beli-api-key' + UTM;
const DASHBOARD_URL = 'https://api.ezkielyna.store';

const DEFAULT_TTS = 'edge-tts';
const DEFAULT_STT = 'whisper-large-v3';
const MAX_TTS_CHARS = 4000;
const MAX_AUDIO_IN = 25 * 1024 * 1024;
const MAX_AUDIO_OUT = 50 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 100000;
const PRICING_TTL_MS = 10 * 60 * 1000;
const HIDDEN_MODEL = /uncensored|abliterated|nsfw/i;

// Default voice per model when the user gives none. Voice names come from the model descriptions in the public
// price list (https://api.ezkielyna.store/api/pricing, checked 11 Nov 2026). Any other voice is passed through as given.
// edge-tts takes Edge voice ids (id-ID-GadisNeural, id-ID-ArdiNeural, en-US-AriaNeural, ...) or an OpenAI voice name.
const DEFAULT_VOICES = {
  'edge-tts': 'id-ID-GadisNeural',
  'tts-kokoro': 'af_heart',
  'tts-xai-v1': 'eve',
  'tts-gemini-3.1-flash': 'Kore',
  'tts-elevenlabs-turbo-v2.5': 'Sarah',
  'tts-minimax-speech-02-hd': 'CalmWoman',
  'tts-qwen3-1.7b': 'Serena',
  'tts-qwen3-0.6b': 'Serena',
  'tts-inworld-1.5-max': 'Olivia',
  'tts-chatterbox-hd': 'Vicky',
};
const FALLBACK_VOICE = 'alloy'; // OpenAI-format default for models not in the table above

const AUDIO_IN = {
  '.mp3': 'audio/mpeg', '.mpga': 'audio/mpeg', '.mpeg': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
  '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac',
};
const GROUP_NAMES = { default: 'Standard', premium: 'Premium', free: 'Hemat', media: 'Media', pro: 'Pro' };

const env = process.env;
const API_KEY = (env.EZKIELYNA_API_KEY || '').trim();
const BASE_URL = (env.EZKIELYNA_BASE_URL || 'https://api.ezkielyna.store/v1').trim().replace(/\/+$/, '');
const AUDIO_DIR = path.resolve(expandHome(env.EZKIELYNA_AUDIO_DIR || path.join(os.homedir(), 'Music', 'Ezkielyna')));
const MAX_CALLS = positiveInt(env.EZKIELYNA_MAX_CALLS, 30);
const TIMEOUT_MS = Math.max(1000, positiveInt(env.EZKIELYNA_TIMEOUT_MS, 300000));

let used = 0; // paid calls sent (or possibly charged) in this session
let pricingCache = null;

function positiveInt(v, dflt) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function expandHome(p) {
  return p === '~' ? os.homedir() : p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(2)) : p;
}

function log(...args) {
  process.stderr.write('[ezkielyna-audio] ' + args.map(a => scrub(String(a))).join(' ') + '\n');
}

function scrub(text) {
  let t = String(text);
  if (API_KEY) t = t.split(API_KEY).join('sk-***');
  return t.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***');
}

class ToolError extends Error {}
class GatewayError extends ToolError {}

const NO_KEY = 'EZKIELYNA_API_KEY belum diisi di konfigurasi MCP / is not set in the MCP config. '
  + `Buat key grup Auto di ${DASHBOARD_URL} (menu API Keys); beli saldo mulai $0.5 di ${BUY_URL}`;

// ---------- tools ----------

const TOOLS = [
  {
    name: 'text_to_speech',
    title: 'Teks ke suara / Text to speech',
    description: 'Turns text into speech with the Ezkielyna API and saves the audio file locally (never overwrites). '
      + `Default model ${DEFAULT_TTS} with voice ${DEFAULT_VOICES[DEFAULT_TTS]} (Indonesian). Max ${MAX_TTS_CHARS} characters. `
      + 'Paid per input character; counts toward the session cap. Run list_audio_models for models, voices and prices.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: `The text to speak (max ${MAX_TTS_CHARS} characters).` },
        model: { type: 'string', description: `TTS model id (default ${DEFAULT_TTS}). See list_audio_models.`, default: DEFAULT_TTS },
        voice: { type: 'string', description: 'Voice name for the model, e.g. id-ID-GadisNeural or id-ID-ArdiNeural (edge-tts), Kore (tts-gemini-3.1-flash). '
          + 'Empty = the model\'s default voice. Passed to the API as given.' },
        format: { type: 'string', enum: ['mp3', 'wav'], default: 'mp3', description: 'Audio format (default mp3). Some models only return MP3; the file extension follows the real audio type.' },
        filename: { type: 'string', description: 'Optional file name (no folder). Existing files are never overwritten.' },
      },
      required: ['text'],
    },
    annotations: { title: 'Text to speech (paid, saves a file)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'transcribe_audio',
    title: 'Suara ke teks / Transcribe audio',
    description: 'Transcribes a local audio file (mp3, m4a, wav, ogg, opus, webm, flac, aac, mp4; max 25 MB) to text with the Ezkielyna API. '
      + `Default model ${DEFAULT_STT}. Optional language hint such as "id" or "en", and subtitle output (srt/vtt). `
      + 'Paid by audio length; counts toward the session cap.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path of the audio file, e.g. /Users/me/Downloads/voice-note.ogg.' },
        model: { type: 'string', description: `Speech-to-text model id (default ${DEFAULT_STT}). See list_audio_models.`, default: DEFAULT_STT },
        language: { type: 'string', description: 'Optional ISO-639-1 language code of the speech, e.g. "id" (Indonesian) or "en". Empty = auto-detect.' },
        response_format: { type: 'string', enum: ['text', 'srt', 'vtt'], default: 'text', description: 'text (default) or subtitles: srt / vtt.' },
        prompt: { type: 'string', description: 'Optional hint with names or terms that appear in the audio (max 500 characters).' },
      },
      required: ['file'],
    },
    annotations: { title: 'Transcribe audio (paid)', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'list_audio_models',
    title: 'Daftar model audio / List audio models',
    description: 'Lists text-to-speech and speech-to-text models from the public Ezkielyna price list with prices, key groups and voices. '
      + 'With a key set it also marks which ones your key can use. Free.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List audio models', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
];

async function callTool(name, args) {
  if (name === 'text_to_speech') return textToSpeech(args);
  if (name === 'transcribe_audio') return transcribeAudio(args);
  if (name === 'list_audio_models') return listAudioModels();
  throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
}

async function textToSpeech(args) {
  const input = optText(args.text);
  if (!input) throw new ToolError('"text" wajib diisi / is required.');
  if (input.length > MAX_TTS_CHARS) {
    throw new ToolError(`Teks ${input.length} karakter, maks ${MAX_TTS_CHARS}. Pecah jadi beberapa bagian. / The text has ${input.length} characters (max ${MAX_TTS_CHARS}): split it into parts.`);
  }
  const model = optText(args.model) || DEFAULT_TTS;
  checkModelId(model);
  const voice = optText(args.voice) || DEFAULT_VOICES[model] || FALLBACK_VOICE;
  if (!/^[A-Za-z0-9 ._:()-]{1,80}$/.test(voice)) throw new ToolError('Nama voice tidak valid / Invalid voice name.');
  const format = optText(args.format).toLowerCase() || 'mp3';
  if (!['mp3', 'wav'].includes(format)) throw new ToolError('format: mp3 atau/or wav.');
  if (!API_KEY) throw new ToolError(NO_KEY);
  reserve();
  let audio;
  try {
    const r = await gateway('/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, voice, response_format: format }) });
    const ctype = String(r.headers.get('content-type') || '');
    const data = await readBody(r, MAX_AUDIO_OUT);
    if (/json|text\//i.test(ctype)) {
      let msg = '';
      try { const v = JSON.parse(data.toString('utf8')); msg = String(v?.error?.message || v?.message || ''); } catch { msg = data.toString('utf8'); }
      throw new GatewayError('Gateway tidak mengirim audio / The gateway did not return audio.'
        + (msg ? ` [${scrub(msg).replace(/\s+/g, ' ').trim().slice(0, 200)}]` : ''));
    }
    const kind = sniffAudio(data);
    if (!kind) throw new ToolError('Jawaban gateway bukan file audio yang dikenal / The gateway answer is not a known audio file. Coba lagi / Try again.');
    audio = { data, ...kind };
  } catch (e) {
    if (e instanceof GatewayError) used--;
    throw e;
  }
  const saved = saveFile(audio.data, args.filename, `ezk-tts-${model}`, audio.ext);
  const prices = await pricing().catch(() => null);
  const p = prices && prices.byModel.get(model);
  const lines = [
    `Tersimpan / Saved: ${saved}`,
    `Model: ${model} | voice: ${voice} | ${audio.ext.toUpperCase()} | ${(audio.data.length / 1024).toFixed(1)} KB | ${input.length} karakter / characters`,
    `Biaya / Cost: ${p && p.rate !== undefined ? `≈ ${fmtUsd(input.length * p.rate / 1e6)} (${fmtUsd(p.rate)} per 1M characters, list price)` : 'lihat / see Usage Logs ' + DASHBOARD_URL}`,
    `Jatah sesi / Session: ${used}/${MAX_CALLS}`,
  ];
  if (audio.ext !== format) lines.push(`Catatan / Note: ${model} mengirim ${audio.ext.toUpperCase()}, bukan ${format.toUpperCase()}; file disimpan sesuai isinya. / ${model} returned ${audio.ext.toUpperCase()}, not ${format.toUpperCase()}; the file is saved as what it really is.`);
  return text(lines.join('\n'));
}

async function transcribeAudio(args) {
  const file = loadAudio(args.file);
  const model = optText(args.model) || DEFAULT_STT;
  checkModelId(model);
  const language = optText(args.language).toLowerCase();
  if (language && !/^[a-z]{2,3}$/.test(language)) throw new ToolError('language: kode ISO-639-1 seperti / a code like "id" or "en".');
  const fmt = optText(args.response_format).toLowerCase() || 'text';
  if (!['text', 'srt', 'vtt'].includes(fmt)) throw new ToolError('response_format: text, srt atau/or vtt.');
  const hint = optText(args.prompt);
  if (hint.length > 500) throw new ToolError('"prompt" maks 500 karakter / max 500 characters.');
  if (!API_KEY) throw new ToolError(NO_KEY);
  reserve();
  let transcript;
  try {
    const form = new FormData();
    form.append('model', model);
    // json for plain text (widely supported); srt/vtt as asked. verbose_json is not used.
    form.append('response_format', fmt === 'text' ? 'json' : fmt);
    if (language) form.append('language', language);
    if (hint) form.append('prompt', hint);
    form.append('file', new Blob([file.data], { type: file.mime }), path.basename(file.path));
    const t0 = Date.now();
    const r = await gateway('/audio/transcriptions', { method: 'POST', body: form });
    const body = (await readBody(r, 8 * 1024 * 1024)).toString('utf8');
    if (fmt === 'text') {
      let v = null;
      try { v = JSON.parse(body); } catch { /* some upstreams answer plain text */ }
      transcript = v && typeof v === 'object' ? (typeof v.text === 'string' ? v.text : null) : body;
      if (transcript === null) throw new ToolError('Jawaban gateway tidak berisi teks / The gateway answer has no "text". Coba lagi / Try again.');
    } else {
      transcript = body;
    }
    transcript = { text: transcript.trim(), ms: Date.now() - t0 };
  } catch (e) {
    if (e instanceof GatewayError) used--;
    throw e;
  }
  const prices = await pricing().catch(() => null);
  const p = prices && prices.byModel.get(model);
  const body = transcript.text || '(Tidak ada ucapan yang terdeteksi / No speech detected.)';
  const lines = [
    clip(body, MAX_TRANSCRIPT_CHARS),
    '',
    '---',
    `File: ${file.path} (${(file.data.length / 1048576).toFixed(2)} MB) | Model: ${model}${language ? ` | language: ${language}` : ''} | ${(transcript.ms / 1000).toFixed(1)} s`,
    `Biaya / Cost: ${p && p.rate !== undefined ? `ditagih per durasi audio, tarif daftar ${fmtUsd(p.rate)} per 1M audio tokens / billed by audio length; exact cost in Usage Logs` : 'lihat / see Usage Logs ' + DASHBOARD_URL}`,
    `Jatah sesi / Session: ${used}/${MAX_CALLS}`,
  ];
  return text(lines.join('\n'));
}

async function listAudioModels() {
  const prices = await pricing();
  const rows = [...prices.byModel.entries()].filter(([, p]) => p.kind === 'tts' || p.kind === 'stt');
  if (!rows.length) throw new ToolError(`Daftar harga tidak bisa dibaca. Lihat / The price list could not be read; see ${DASHBOARD_URL}/pricing`);
  let mine = null;
  if (API_KEY) {
    try {
      const r = await gateway('/models', { method: 'GET' });
      const v = JSON.parse((await readBody(r, 4 * 1024 * 1024)).toString('utf8'));
      mine = new Set((v?.data || []).map(m => m && m.id).filter(id => typeof id === 'string'));
    } catch (e) {
      if (e instanceof GatewayError && /Wrong or inactive API key/.test(e.message)) throw e;
      mine = null;
    }
  }
  const fmtRow = ([id, p]) => {
    const parts = [`- ${id}: ${fmtUsd(p.rate)} per 1M ${p.kind === 'tts' ? 'characters' : 'audio tokens (billed by audio length)'}`];
    if (p.groups.length) parts.push(`groups: ${p.groups.join(', ')}`);
    if (mine) parts.push(mine.has(id) ? 'key ini / your key: OK' : 'key ini / your key: tidak / no');
    if (p.voices) parts.push(`voices: ${p.voices}`);
    if (p.formats) parts.push(`formats: ${p.formats}`);
    return parts.join(' | ') + (DEFAULT_VOICES[id] ? ` | default voice: ${DEFAULT_VOICES[id]}` : '');
  };
  const sort = (a, b) => a[1].rate - b[1].rate || a[0].localeCompare(b[0]);
  const tts = rows.filter(([, p]) => p.kind === 'tts').sort(sort).map(fmtRow);
  const stt = rows.filter(([, p]) => p.kind === 'stt').sort(sort).map(fmtRow);
  return text([
    'Text to speech (text_to_speech):', ...tts, '',
    'Speech to text (transcribe_audio):', ...stt, '',
    `Default: ${DEFAULT_TTS} (voice ${DEFAULT_VOICES[DEFAULT_TTS]}) dan / and ${DEFAULT_STT}.`,
    'Harga daftar USD, sudah termasuk pengali grup terendah. Grup = grup key yang bisa memakai model itu (Auto mencakup Standard, Premium, Hemat). '
      + '/ List prices in USD at the lowest group multiplier. Groups = key groups that can use the model (Auto covers Standard, Premium and Hemat).',
    `Jatah sesi / Session: ${used}/${MAX_CALLS}. Folder: ${AUDIO_DIR}`,
  ].join('\n'));
}

// ---------- session cap ----------

function reserve() {
  if (used >= MAX_CALLS) {
    throw new ToolError(`Batas ${MAX_CALLS} panggilan per sesi tercapai (EZKIELYNA_MAX_CALLS). Mulai ulang MCP untuk lanjut. `
      + `/ Session limit of ${MAX_CALLS} paid calls reached: restart the MCP server or raise EZKIELYNA_MAX_CALLS.`);
  }
  used++;
}

// ---------- gateway ----------

async function gateway(p, init) {
  if (!API_KEY) throw new ToolError(NO_KEY);
  const headers = { Authorization: 'Bearer ' + API_KEY, 'User-Agent': 'ezkielyna-audio-mcp/' + VERSION, ...(init.headers || {}) };
  let r;
  try {
    r = await fetch(BASE_URL + p, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ToolError((timeout ? 'Gateway terlalu lama menjawab / Gateway timed out.' : 'Tidak bisa menghubungi gateway / Could not reach the gateway.')
      + ` (${BASE_URL}) Cek koneksi internet lalu coba lagi. / Check your connection and try again.`
      + (init.method === 'POST' ? ` Jika sudah ditagih, cek Usage Logs di ${DASHBOARD_URL}. / If it was charged, check your usage logs.` : ''));
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new GatewayError(friendlyError(r.status, body));
  }
  return r;
}

async function readBody(r, limit) {
  if (Number(r.headers.get('content-length')) > limit) throw new ToolError(`Jawaban terlalu besar / The answer is too large (> ${Math.round(limit / 1048576)} MB).`);
  const chunks = [];
  let size = 0;
  if (!r.body) return Buffer.alloc(0);
  for await (const c of r.body) {
    size += c.length;
    if (size > limit) throw new ToolError(`Jawaban terlalu besar / The answer is too large (> ${Math.round(limit / 1048576)} MB).`);
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

function friendlyError(status, body) {
  let msg = '';
  let code = '';
  try {
    const v = JSON.parse(body);
    const e = v && typeof v.error === 'object' ? v.error : v;
    msg = String((e && (e.message || e.msg)) || (typeof v.error === 'string' ? v.error : '') || '');
    code = String((e && (e.code || e.type)) || '');
  } catch { msg = body; }
  const all = (msg + ' ' + code).toLowerCase();
  const detail = scrub(msg).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200).replace(/[.\s]+$/, '');
  if (status === 401) return 'Key API salah atau tidak aktif. Cek EZKIELYNA_API_KEY. / Wrong or inactive API key: check EZKIELYNA_API_KEY.';
  const balance = `Saldo API tidak cukup. Top up di ${BUY_URL} lalu coba lagi. / Insufficient API balance: top up and try again.`;
  if (status === 402) return balance;
  if (status === 413) return 'File terlalu besar untuk gateway (maks 25 MB). / The file is too large for the gateway (max 25 MB).';
  const groupText = /group|not allowed|forbidden|no available channel|分组|无权|权限|无可用渠道/.test(all);
  if (status === 429 || (status >= 500 && !groupText)) return 'Layanan audio sedang sibuk atau gangguan. Tunggu sebentar lalu coba lagi, atau pilih model lain. / The audio service is busy or failing: wait and retry, or pick another model.';
  if (/insufficient|quota|balance|额度|余额|saldo/.test(all)) return balance;
  if (status === 403 || groupText) {
    return 'Grup key ini tidak bisa memakai model ini. Jalankan list_audio_models (kolom groups), atau buat key grup Auto. '
      + '/ This key\'s group cannot use this model: check the groups in list_audio_models, or create a key in group Auto.' + (detail ? ` [${detail}]` : '');
  }
  if (status === 404 || /model_not_found|not found|不存在/.test(all)) {
    return 'Model tidak tersedia untuk key ini. Jalankan list_audio_models. / Model not available for this key: run list_audio_models.' + (detail ? ` [${detail}]` : '');
  }
  if (status === 400) return `Permintaan ditolak / Request rejected${detail ? `: ${detail}` : ''}. Cek voice/format/bahasa / Check the voice, format or language.`;
  return `Gateway error ${status}` + (detail ? `: ${detail}` : '') + '. Coba lagi nanti / Try again later.';
}

// ---------- prices (public, no key) ----------

function voicesOf(desc) {
  const m = /\bvoice\s*[:=]\s*(.+?)(?:\.\s|\.$|$)/i.exec(desc);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 160) : '';
}

function formatsOf(desc) {
  const f = '(?:MP3|WAV|Opus|AAC|FLAC|PCM)';
  const m = new RegExp(`\\b${f}(?:\\/${f})*(?: only)?\\b`, 'i').exec(desc);
  return m ? m[0] : '';
}

async function pricing() {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache;
  const byModel = new Map();
  try {
    const r = await fetch(new URL(BASE_URL).origin + '/api/pricing', { signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, 20000)), headers: { 'User-Agent': 'ezkielyna-audio-mcp/' + VERSION } });
    const v = r.ok ? await r.json() : null;
    const ratios = v && typeof v.group_ratio === 'object' && v.group_ratio ? v.group_ratio : {};
    for (const m of Array.isArray(v?.data) ? v.data : []) {
      if (!m || typeof m.model_name !== 'string' || HIDDEN_MODEL.test(m.model_name)) continue;
      const id = m.model_name;
      const tags = String(m.tags || '').toUpperCase();
      const kind = tags === 'TTS' || /^tts-|^edge-tts$/.test(id) ? 'tts' : tags === 'STT' || /^stt-|whisper/.test(id) ? 'stt' : '';
      if (!kind) continue;
      const groups = (Array.isArray(m.enable_groups) ? m.enable_groups : []).filter(g => Number(ratios[g]) > 0);
      const mult = groups.length ? Math.min(...groups.map(g => Number(ratios[g]))) : 1;
      const desc = String(m.description || '');
      byModel.set(id, {
        kind,
        // New API: ratio 1 = $2 per 1M units (characters for TTS, audio tokens for STT); per-call models use model_price.
        rate: m.quota_type === 1 ? undefined : Number(m.model_ratio) * 2 * mult,
        groups: groups.map(g => GROUP_NAMES[g] || g),
        voices: kind === 'tts' ? voicesOf(desc) : '',
        formats: kind === 'tts' ? formatsOf(desc) : '',
      });
    }
    if (!byModel.size) throw new Error('no audio models in pricing');
    pricingCache = { at: Date.now(), byModel };
  } catch (e) {
    log('pricing unavailable:', e && e.message);
    return pricingCache || { at: 0, byModel };
  }
  return pricingCache;
}

function fmtUsd(n) {
  if (!Number.isFinite(n)) return '?';
  if (n === 0) return '$0';
  if (n < 0.000001) return '< $0.000001';
  return '$' + Number(n.toPrecision(n < 0.01 ? 3 : 4)).toString();
}

// ---------- files ----------

function sniffAudio(b) {
  if (b.length < 4) return null;
  if (b.toString('ascii', 0, 3) === 'ID3') return { ext: 'mp3' };
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return { ext: 'wav' };
  if (b.toString('ascii', 0, 4) === 'OggS') return { ext: 'ogg' };
  if (b.toString('ascii', 0, 4) === 'fLaC') return { ext: 'flac' };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    if ((b[1] & 0x06) === 0) return { ext: 'aac' }; // ADTS (layer bits 00)
    return { ext: 'mp3' }; // MPEG audio frame sync
  }
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return { ext: 'm4a' };
  return null;
}

function loadAudio(ref0) {
  const ref = optText(ref0);
  if (!ref) throw new ToolError('"file" wajib diisi (path file audio) / is required (path of an audio file).');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref) && !ref.startsWith('file://')) throw new ToolError('Kirim path file lokal, bukan link. / Pass a local file path, not a URL.');
  let p = path.resolve(expandHome(ref.startsWith('file://') ? fileURLToPath(ref) : ref));
  if (!fs.existsSync(p) && !path.isAbsolute(expandHome(ref))) {
    const inDir = path.resolve(AUDIO_DIR, ref);
    if (fs.existsSync(inDir)) p = inDir;
  }
  const mime = AUDIO_IN[path.extname(p).toLowerCase()];
  if (!mime) throw new ToolError(`Jenis file tidak didukung / Unsupported file type: ${p}. Pakai / use ${Object.keys(AUDIO_IN).join(' ')}`);
  let st;
  try { st = fs.statSync(p); } catch { throw new ToolError(`File tidak ditemukan / File not found: ${p} (pakai path lengkap / use the full path)`); }
  if (!st.isFile()) throw new ToolError(`Bukan file / Not a file: ${p}`);
  if (st.size === 0) throw new ToolError(`File kosong / Empty file: ${p}`);
  if (st.size > MAX_AUDIO_IN) throw new ToolError(`File ${(st.size / 1048576).toFixed(1)} MB, maks 25 MB. Potong atau kompres (mis. MP3 64 kbps). / File is larger than 25 MB: split or compress it.`);
  return { path: p, mime, data: fs.readFileSync(p) };
}

function safeBase(filename, prefix) {
  let base = path.basename(String(filename || '').replace(/\\/g, '/')).replace(/\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i, '');
  base = base.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 80);
  if (!base) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    base = `${prefix.replace(/[^A-Za-z0-9.-]+/g, '-')}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  return base;
}

// Writes inside AUDIO_DIR only, never over an existing file (name.mp3, name-1.mp3, name-2.mp3, ...).
function saveFile(data, filename, prefix, ext) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const dir = fs.realpathSync(AUDIO_DIR);
  const base = safeBase(filename, prefix);
  for (let i = 0; i < 10000; i++) {
    const p = path.join(dir, `${base}${i ? '-' + i : ''}.${ext}`);
    if (path.dirname(p) !== dir) throw new ToolError('Nama file tidak valid / Invalid file name.');
    try {
      fs.writeFileSync(p, data, { flag: 'wx' });
      return p;
    } catch (e) {
      if (e.code !== 'EEXIST') throw new ToolError(`Gagal menyimpan / Could not save in ${dir}: ${e.code || e.message}`);
    }
  }
  throw new ToolError('Terlalu banyak file dengan nama sama / Too many files with this name.');
}

// ---------- argument helpers ----------

function optText(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function checkModelId(m) {
  if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(m)) throw new ToolError('Nama model tidak valid / Invalid model id. Run list_audio_models.');
  if (HIDDEN_MODEL.test(m)) throw new ToolError('Model ini tidak tersedia lewat MCP ini / This model is not available through this MCP server.');
}

function clip(t, max) {
  return t.length > max ? t.slice(0, max) + `\n\n[... dipotong / truncated at ${max} characters]` : t;
}

function text(t, isError = false) {
  return isError ? { content: [{ type: 'text', text: t }], isError: true } : { content: [{ type: 'text', text: t }] };
}

// ---------- JSON-RPC over stdio ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== 'string') {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } });
    return;
  }
  if (!isRequest) return;
  try {
    let result;
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ezkielyna-audio', title: 'Ezkielyna Audio', version: VERSION },
          instructions: 'text_to_speech saves speech as a local audio file (never overwrites); transcribe_audio turns a local audio file into text '
            + '(language hint e.g. "id"); list_audio_models shows models, voices and prices. Paid calls count toward a per-session cap.',
        };
        break;
      }
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools: TOOLS }; break;
      case 'resources/list': result = { resources: [] }; break;
      case 'resources/templates/list': result = { resourceTemplates: [] }; break;
      case 'prompts/list': result = { prompts: [] }; break;
      case 'tools/call': {
        const name = params && params.name;
        if (!TOOLS.some(t => t.name === name)) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${scrub(String(name))}` } });
          return;
        }
        const token = params && params._meta && params._meta.progressToken;
        let tick = 0;
        const timer = token !== undefined && token !== null
          ? setInterval(() => send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++tick, message: 'Memproses audio... / Working...' } }), 10000)
          : null;
        try {
          result = await callTool(name, (params && typeof params.arguments === 'object' && params.arguments) || {});
        } catch (e) {
          if (!(e instanceof ToolError)) log('tool failed:', e && e.stack || e);
          result = text(scrub(e instanceof ToolError ? e.message : 'Terjadi kesalahan / Unexpected error: ' + (e && e.message)), true);
        } finally {
          if (timer) clearInterval(timer);
        }
        break;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    log('request failed:', e && e.stack || e);
    send({ jsonrpc: '2.0', id, error: { code: e.rpcCode || -32603, message: scrub(e.message || 'Internal error') } });
  }
}

function main() {
  if (!API_KEY) log('warning: EZKIELYNA_API_KEY is not set; paid tools will answer with setup instructions.');
  log(`v${VERSION} ready; base ${BASE_URL}; audio saved to ${AUDIO_DIR}; session cap ${MAX_CALLS}`);
  const pending = new Set();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const msgs = Array.isArray(msg) ? msg : [msg];
    for (const m of msgs) {
      const p = handle(m && typeof m === 'object' ? m : {}).catch(e => log('fatal handler error:', e && e.stack || e));
      pending.add(p);
      p.finally(() => pending.delete(p));
    }
  });
  rl.on('close', async () => {
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
}

main();
