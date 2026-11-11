# Publish notes (owner)

Built locally on 11 Nov 2026. Nothing is pushed or published yet.

- **GitHub repo:** `EzkielynaGroup/ezkielyna-audio-mcp` (public)
- **Description (<= 120 chars):** MCP server: text to speech and speech to text (Indonesian too) from local audio files via the Ezkielyna API
- **Homepage:** https://ezkielyna.store/?utm_source=github&utm_medium=repo&utm_campaign=ezkielyna-audio-mcp
- **Topics:** mcp, mcp-server, model-context-protocol, text-to-speech, tts, speech-to-text, transcription, whisper, edge-tts, bahasa-indonesia, claude-desktop, claude-code, cursor

## Owner actions
1. Create the repo under EzkielynaGroup, push `main` (run `bash gh_public_check.sh <dir>` again first).
2. `npm publish` (package `ezkielyna-audio-mcp`, check the name is free: `npm view ezkielyna-audio-mcp`).
3. MCP Registry: `mcp-publisher publish` with `server.json`.
4. Decide the key group wording: the public price list (11 Nov 2026) enables audio models for Standard/Premium (edge-tts also Hemat),
   not Media. README says "Auto (or Standard/Premium)". If Media keys should work for audio, enable the group on the gateway first.
5. Optional live smoke test with a real key: `text_to_speech` (edge-tts, voices id-ID-GadisNeural / id-ID-ArdiNeural; also a `wav`
   request on a model that supports WAV), `transcribe_audio` (short Indonesian .ogg, `language: id`, then `srt`), `list_audio_models`.
