# Tutorial Clarity - Multi-Voice Quick Start

## In 5 Steps:

1. **Load video** — Paste YouTube URL
2. **Detect speakers** — Click "🎯 Detect Speakers with AI"
3. **Verify** — Check speaker distribution in console
4. **Generate** — Click "Apply & Regenerate Audio"
5. **Play** — Click "▶️ Play Clarified Audio"

## Voice Assignment

| Speaker   | Default Gender | Voice    |
|-----------|---------------|----------|
| Speaker 0 | Female        | Nova     |
| Speaker 1 | Male          | Onyx     |
| Speaker 2 | Female        | Shimmer  |

You can change genders in the Speaker Voices panel before regenerating.

## Test Tool

Use **"🧪 Test Audio Blobs"** to preview first 5 segments before full playback.

## Buttons

| Button | What it does |
|--------|-------------|
| 🎯 AI Detection | Best accuracy (uses AssemblyAI API) |
| 🔧 Manual Detection | Fast, less accurate (gap-based, no API) |
| 🧪 Test Blobs | Preview first 5 segments with voice info |
| 🔴 Nuclear Clear | Start over (clears all cached audio) |

## Console Messages to Watch For

- `✅ Labels still preserved` — Speaker labels survived React re-renders
- `✅ Multi-voice confirmed` — Multiple distinct voices in generated audio
- `❌ All speaker_0` — Problem: all segments same speaker
- `[▶ PLAY] ... ✅` — Correct voice playing for segment
- `[▶ PLAY] ... ❌ MISMATCH` — Wrong voice playing (report this!)
