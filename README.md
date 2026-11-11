# Ezkielyna Audio MCP

<!-- ezk:badges -->
[![npm](https://img.shields.io/npm/v/ezkielyna-audio-mcp?color=c2410c)](https://www.npmjs.com/package/ezkielyna-audio-mcp) [![CI](https://github.com/EzkielynaGroup/ezkielyna-audio-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/EzkielynaGroup/ezkielyna-audio-mcp/actions/workflows/test.yml) [![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.EzkielynaGroup%2Fezkielyna--audio--mcp-1f6feb)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.EzkielynaGroup/ezkielyna-audio-mcp) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
<!-- /ezk:badges -->

An [MCP](https://modelcontextprotocol.io) server that gives your AI assistant **text to speech** (saved as local MP3/WAV files) and **speech to text from local audio files**, including Indonesian, through the [Ezkielyna API](https://ezkielyna.store/?utm_source=github&utm_medium=readme&utm_campaign=ezkielyna-audio-mcp). Works in Claude Desktop, Claude Code, Cursor, OpenCode and any other MCP client that runs local stdio servers.

Examples:
- *"Transcribe `~/Downloads/voice-note.ogg` (it's in Indonesian) and summarise it in three bullet points."*
- *"Read this product description aloud in Indonesian and save it as promo-kopi."*

> 🇮🇩 Bahasa Indonesia: lihat [bagian di bawah](#bahasa-indonesia).

- **One file, no dependencies**: only Node.js 18 or newer. No `npm install`.
- Audio is saved in one folder and existing files are never overwritten.
- Paid calls are capped per session and the API key is never printed.

## Requirements

1. **Node.js 18+** (`node -v`). Get the LTS from [nodejs.org](https://nodejs.org).
2. An **Ezkielyna API key whose group includes the audio models**. The simplest choice is **Auto**. According to the public price list (checked 11 Nov 2026) the speech models are enabled for the **Standard** and **Premium** groups, and `edge-tts` also for **Hemat**; the **Media** group (image and video) did not list them. `list_audio_models` shows the groups per model and, with a key set, whether your key can use each one. Buy API Credit at [ezkielyna.store/beli-api-key](https://ezkielyna.store/beli-api-key?utm_source=github&utm_medium=readme&utm_campaign=ezkielyna-audio-mcp) (from $0.5, QRIS/DANA/GoPay/USDT), redeem it under **Wallet** at [api.ezkielyna.store](https://api.ezkielyna.store), then create a key under **API Keys**.

## Tools

| Tool | What it does | Cost |
|---|---|---|
| `text_to_speech` | Text (max 4,000 characters) to speech, saved in `EZKIELYNA_AUDIO_DIR`. `model` default `edge-tts`, `voice` (default per model, see below), `format` `mp3` (default) or `wav`, optional `filename`. | per input character |
| `transcribe_audio` | Transcribes a local file (mp3, m4a, mp4, wav, ogg, oga, opus, webm, flac, aac, mpga, mpeg; max 25 MB). `model` default `whisper-large-v3`, optional `language` (e.g. `id`, `en`), `response_format` `text` (default), `srt` or `vtt`, optional `prompt` with names or terms. | by audio length |
| `list_audio_models` | TTS and STT models from the public price list with price, key groups, voices and formats. With a key set, marks which ones your key can use. | free |

Price examples (public price list, 11 Nov 2026, list prices in USD): `edge-tts` $1 per 1M characters, so a 4,000-character text is about $0.004; `whisper-large-v3` is listed at $12 per 1M audio tokens and billed by audio length (see **Usage Logs** on [api.ezkielyna.store](https://api.ezkielyna.store) for the exact charge).

### Voices

The voice is passed to the OpenAI-format `POST /v1/audio/speech` endpoint as you give it. Defaults, taken from the model descriptions in the public price list (11 Nov 2026):

| Model | Default voice | Other voices named in the price list |
|---|---|---|
| `edge-tts` | `id-ID-GadisNeural` (Indonesian, female) | `id-ID-ArdiNeural` (Indonesian, male), `en-US-AriaNeural`, other Edge voice ids, or an OpenAI voice name. MP3 only. |
| `tts-gemini-3.1-flash` | `Kore` | Puck, Charon, Aoede, Zephyr, Fenrir, Leda, Orus |
| `tts-xai-v1` | `eve` | ara, leo, rex, luna, orion, sirius |
| `tts-kokoro` | `af_heart` | af_bella, am_adam, bf_emma (no Indonesian) |
| other models | see `list_audio_models` | any model not in the built-in table defaults to `alloy` |

If the model returns a different format than requested (for example `edge-tts` only returns MP3), the file is saved with the extension of the audio it really contains and the answer says so.

## Install

**With npx (recommended):** nothing to install. The configs below run `npx -y ezkielyna-audio-mcp`.

**From source:**

```bash
git clone https://github.com/EzkielynaGroup/ezkielyna-audio-mcp.git
cd ezkielyna-audio-mcp
node --test test/        # optional: local mock server, no network, no cost
```

Then use `"command": "node"` with `"args": ["/full/path/to/ezkielyna-audio-mcp.mjs"]` instead of `npx`.

**Windows:** if the app cannot start `npx`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "ezkielyna-audio-mcp"]`. Write paths in JSON with forward slashes (`C:/Users/you/Music/Ezkielyna`).

## Add it to your app

Replace `sk-...` with your key.

**Claude Code**

```bash
claude mcp add ezkielyna-audio -e EZKIELYNA_API_KEY=sk-... -- npx -y ezkielyna-audio-mcp
```

Add `--scope user` to make it available in every project.

**Claude Desktop**: Settings → Developer → Edit Config (`claude_desktop_config.json`), then quit and reopen Claude Desktop.

```json
{
  "mcpServers": {
    "ezkielyna-audio": {
      "command": "npx",
      "args": ["-y", "ezkielyna-audio-mcp"],
      "env": { "EZKIELYNA_API_KEY": "sk-..." }
    }
  }
}
```

**Cursor**: `~/.cursor/mcp.json` or `.cursor/mcp.json`, same JSON as Claude Desktop.

**OpenCode**: `opencode.json` in the project, or `~/.config/opencode/opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ezkielyna-audio": {
      "type": "local",
      "command": ["npx", "-y", "ezkielyna-audio-mcp"],
      "enabled": true,
      "environment": { "EZKIELYNA_API_KEY": "sk-..." }
    }
  }
}
```

## Configuration (environment)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `EZKIELYNA_API_KEY` | yes (except `list_audio_models`) | | key in group **Auto** (or Standard/Premium, see above) |
| `EZKIELYNA_BASE_URL` | no | `https://api.ezkielyna.store/v1` | API address |
| `EZKIELYNA_AUDIO_DIR` | no | `~/Music/Ezkielyna` | where speech files are saved (created if missing) |
| `EZKIELYNA_MAX_CALLS` | no | `30` | paid calls per session (`text_to_speech` + `transcribe_audio`); restart the app to reset |
| `EZKIELYNA_TIMEOUT_MS` | no | `300000` | request timeout |

## Safety and limits

- Reads only audio files with a known extension, up to 25 MB; URLs are refused (local files only). A bare file name is also looked up in the audio folder, so a file `text_to_speech` just saved can be transcribed again.
- Writes only inside `EZKIELYNA_AUDIO_DIR`, sanitises file names and never overwrites (`name.mp3`, `name-1.mp3`, ...). An answer that is not audio is refused and nothing is saved.
- Text is limited to 4,000 characters per call; transcripts longer than 100,000 characters are truncated.
- The session cap is checked before anything is sent. Calls the gateway clearly refused give their slot back.
- The key is scrubbed from every answer and log line. Logs go to stderr; stdout carries only MCP messages.

## Data source

Model list, prices, groups and voice names come at runtime from the public endpoint `https://api.ezkielyna.store/api/pricing` (no key, cached 10 minutes). Price per 1M units = `model_ratio × 2 × lowest group multiplier` (New API convention), matching `https://api.ezkielyna.store/llms-full.txt` (checked 11 Nov 2026). Nothing is bundled. The voice table above was copied from the same price list on 11 Nov 2026; models and voices can change, so `list_audio_models` is the current source.

## FAQ

**How can I transcribe an Indonesian voice note with Claude?**
Add this server, then ask "transcribe ~/Downloads/note.ogg, language id". Claude calls `transcribe_audio` with `whisper-large-v3` and gets the text back.

**Is there an Indonesian text-to-speech voice for Claude Desktop or Cursor?**
Yes. The default `edge-tts` voice is `id-ID-GadisNeural` (female); use `id-ID-ArdiNeural` for a male voice.

**Can I make subtitles (SRT/VTT) from a video's audio?**
Yes, set `response_format` to `srt` or `vtt`. Extract the audio first (for example `ffmpeg -i video.mp4 -vn -b:a 64k audio.mp3`) if the file is over 25 MB.

**Where are the audio files saved?**
In `~/Music/Ezkielyna` unless you set `EZKIELYNA_AUDIO_DIR`. Existing files are never overwritten.

**Is Ezkielyna affiliated with Microsoft, OpenAI or Google?**
No. Ezkielyna is an independent API gateway and is not affiliated with the model vendors or the MCP client makers.

## Development

```bash
node --test test/
```

The tests spawn the server over stdio against a local mock gateway: no internet, no cost.

---

## Bahasa Indonesia

Server MCP agar asisten AI Anda (Claude Desktop, Claude Code, Cursor, OpenCode) bisa **mengubah teks jadi suara** (disimpan sebagai file MP3/WAV) dan **mengubah file audio di komputer jadi teks**, termasuk bahasa Indonesia, lewat [Ezkielyna API](https://ezkielyna.store/?utm_source=github&utm_medium=readme&utm_campaign=ezkielyna-audio-mcp).

Contoh:
- *"Transkrip `~/Downloads/vn-pelanggan.ogg` (bahasa Indonesia), lalu ringkas jadi 3 poin."*
- *"Bacakan deskripsi produk ini dengan suara perempuan bahasa Indonesia, simpan sebagai promo-kopi."*

### Yang dibutuhkan

1. **Node.js 18+**. Cukup satu file, tanpa `npm install`.
2. **API key Ezkielyna** yang grupnya mencakup model audio. Paling mudah: grup **Auto**. Menurut daftar harga publik (dicek 11 Nov 2026), model suara aktif di grup **Standard** dan **Premium**, dan `edge-tts` juga di **Hemat**; grup **Media** (gambar/video) tidak mencantumkannya. Beli API Credit mulai $0.5 lewat QRIS/DANA/GoPay/USDT di [ezkielyna.store/beli-api-key](https://ezkielyna.store/beli-api-key?utm_source=github&utm_medium=readme&utm_campaign=ezkielyna-audio-mcp), tukarkan di menu **Wallet** di [api.ezkielyna.store](https://api.ezkielyna.store), lalu buat key di menu **API Keys**.

### Tool

| Tool | Fungsi | Biaya |
|---|---|---|
| `text_to_speech` | Teks (maks 4.000 karakter) jadi suara, disimpan di `EZKIELYNA_AUDIO_DIR` (default `~/Music/Ezkielyna`). Default `edge-tts` dengan suara `id-ID-GadisNeural`; suara laki-laki: `id-ID-ArdiNeural`. Format `mp3` atau `wav`. | per karakter |
| `transcribe_audio` | File audio lokal (maks 25 MB) jadi teks. Default `whisper-large-v3`, opsional `language` (mis. `id`), hasil `text`, `srt` atau `vtt` (subtitle). | per durasi audio |
| `list_audio_models` | Daftar model TTS/STT dengan harga, grup key, suara, dan format. | gratis |

Contoh harga (daftar harga publik, 11 Nov 2026): `edge-tts` $1 per 1 juta karakter, jadi 4.000 karakter sekitar $0.004. Biaya pasti ada di **Usage Logs** dashboard.

### Pemasangan

Claude Code:

```bash
claude mcp add ezkielyna-audio -e EZKIELYNA_API_KEY=sk-... -- npx -y ezkielyna-audio-mcp
```

Claude Desktop, Cursor dan OpenCode: pakai contoh JSON di bagian Inggris di atas, cukup ganti `sk-...`. Di Windows, jika `npx` tidak jalan, pakai `"command": "cmd"` dan `"args": ["/c", "npx", "-y", "ezkielyna-audio-mcp"]`.

### Keamanan dan batas

- `EZKIELYNA_MAX_CALLS` (default 30): batas panggilan berbayar per sesi, dicek sebelum permintaan dikirim.
- Hanya membaca file audio (maks 25 MB), bukan link. Hanya menulis di folder audio dan tidak pernah menimpa file yang sudah ada.
- Key tidak pernah ditampilkan di jawaban maupun log.

### Tanya jawab

**Bagaimana cara transkrip voice note WhatsApp berbahasa Indonesia dengan Claude?**
Simpan voice note (.ogg/.opus) ke komputer, pasang server ini, lalu minta "transkrip file ini, bahasa id".

**Apakah ada suara Indonesia untuk text to speech?**
Ada: `id-ID-GadisNeural` (perempuan, default) dan `id-ID-ArdiNeural` (laki-laki) di `edge-tts`.

**Apakah Ezkielyna berafiliasi dengan Microsoft, OpenAI atau Google?**
Tidak. Ezkielyna adalah API gateway independen.

## License

MIT, Copyright (c) 2026 Ezekiel Lieberhart (Ezkielyna). Ezkielyna is an independent API gateway and is not affiliated with the model vendors or the MCP client makers.

<!-- ezk:toolkit -->
---

### Part of the Ezkielyna developer toolkit

Open-source tools from [Ezkielyna](https://ezkielyna.store/?utm_source=github&utm_medium=readme&utm_campaign=ezkielyna-audio-mcp), an independent OpenAI- and Anthropic-compatible AI API gateway (pay with QRIS, USDT or Binance Pay; no credit card).

| No API key needed | With an Ezkielyna key |
|---|---|
| [mcp-bmkg](https://github.com/EzkielynaGroup/mcp-bmkg) · [mcp-wilayah-indonesia](https://github.com/EzkielynaGroup/mcp-wilayah-indonesia) · [mcp-hari-libur-indonesia](https://github.com/EzkielynaGroup/mcp-hari-libur-indonesia) · [mcp-rupiah](https://github.com/EzkielynaGroup/mcp-rupiah) · [mcp-qris](https://github.com/EzkielynaGroup/mcp-qris) · [ai-model-status-mcp](https://github.com/EzkielynaGroup/ai-model-status-mcp) | [ezkielyna-mcp](https://github.com/EzkielynaGroup/ezkielyna-mcp) · [ezkielyna-image-mcp](https://github.com/EzkielynaGroup/ezkielyna-image-mcp) · [ezkielyna-audio-mcp](https://github.com/EzkielynaGroup/ezkielyna-audio-mcp) · [n8n-nodes-ezkielyna](https://github.com/EzkielynaGroup/n8n-nodes-ezkielyna) |

More: [all repositories](https://github.com/EzkielynaGroup) · [awesome-mcp-indonesia](https://github.com/EzkielynaGroup/awesome-mcp-indonesia) · [awesome-ai-indonesia](https://github.com/EzkielynaGroup/awesome-ai-indonesia)
<!-- /ezk:toolkit -->
