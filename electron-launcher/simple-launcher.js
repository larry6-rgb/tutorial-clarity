/**
 * Tutorial Clarity — Simple Clipboard Launcher (NO ELECTRON NEEDED)
 *
 * Pure Node.js — no native binaries, no Electron download issues.
 * Works on Windows, Mac, and Linux.
 *
 * TWO-STEP WORKFLOW:
 *   1. Copy a YouTube URL
 *   2. Console shows: "YouTube URL detected! Press ENTER to open in Tutorial Clarity"
 *   3. Press ENTER (this gives you time to pause the YouTube video first)
 *   4. Tutorial Clarity opens in your default browser
 *
 * Usage:
 *   cd electron-launcher
 *   npm run simple        (uses this file)
 *
 * Or directly:
 *   node simple-launcher.js
 */

import clipboardy from 'clipboardy';
import open from 'open';
import readline from 'readline';

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL_MS = 1500;
// ────────────────────────────────────────────────────────────────────

let lastClipboard = '';
let pendingUrl = null;
let urlCount = 0;

// ── YouTube URL Detection ───────────────────────────────────────────

function extractYouTubeUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  return null;
}

// ── Terminal Colors ─────────────────────────────────────────────────

const PINK = '\x1b[35m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// ── Console UI ──────────────────────────────────────────────────────

function showBanner() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║     🎯 Tutorial Clarity — Clipboard Launcher     ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═══════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`${DIM}  Watching clipboard for YouTube URLs...${RESET}`);
  console.log(`${DIM}  Copy any YouTube URL to get started.${RESET}`);
  console.log(`${DIM}  Press Ctrl+C to quit.${RESET}`);
  console.log('');
}

function showStep1(youtubeUrl) {
  console.log('');
  console.log(`${PINK}${BOLD}╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${PINK}${BOLD}║  🔗 YouTube URL Detected!                        ║${RESET}`);
  console.log(`${PINK}${BOLD}╚═══════════════════════════════════════════════════╝${RESET}`);
  console.log(`${PINK}  ${youtubeUrl}${RESET}`);
  console.log('');
  console.log(`${YELLOW}${BOLD}  ⏸  STEP 1: Pause your YouTube video first!${RESET}`);
  console.log(`${YELLOW}${BOLD}  ⏎  STEP 2: Press ENTER to open in Tutorial Clarity${RESET}`);
  console.log('');
}

function showOpened(youtubeUrl) {
  console.log(`${GREEN}${BOLD}  ✅ Opened in Tutorial Clarity!${RESET}`);
  console.log(`${DIM}  ${TC_BASE_URL}/watch?url=...${RESET}`);
  console.log('');
  console.log(`${DIM}  Watching clipboard for more URLs...${RESET}`);
  console.log('');
}

// ── Open Tutorial Clarity ───────────────────────────────────────────

async function openInTutorialClarity(youtubeUrl) {
  const encodedUrl = encodeURIComponent(youtubeUrl);
  const tcUrl = `${TC_BASE_URL}/watch?url=${encodedUrl}`;
  
  try {
    await open(tcUrl);
    urlCount++;
    showOpened(youtubeUrl);
  } catch (err) {
    console.error(`  ❌ Failed to open browser: ${err.message}`);
    console.log(`  📋 Copy this URL manually: ${tcUrl}`);
    console.log('');
  }
}

// ── Clipboard Polling ───────────────────────────────────────────────

function checkClipboard() {
  try {
    const current = clipboardy.readSync().trim();
    if (current && current !== lastClipboard) {
      lastClipboard = current;
      const ytUrl = extractYouTubeUrl(current);
      if (ytUrl && ytUrl !== pendingUrl) {
        pendingUrl = ytUrl;
        showStep1(ytUrl);
      }
    }
  } catch {
    // Clipboard read can fail sometimes — ignore silently
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  showBanner();

  // Capture current clipboard so we don't trigger on pre-existing content
  try {
    lastClipboard = clipboardy.readSync().trim();
  } catch {
    lastClipboard = '';
  }

  // Start clipboard polling
  const pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);

  // Listen for ENTER key to open the pending URL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle raw keypress for ENTER
  process.stdin.setRawMode && process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', async (key) => {
    // Ctrl+C
    if (key === '\u0003') {
      console.log('');
      console.log(`${DIM}  👋 Goodbye! Opened ${urlCount} video(s) this session.${RESET}`);
      clearInterval(pollTimer);
      process.exit(0);
    }

    // ENTER key
    if (key === '\r' || key === '\n') {
      if (pendingUrl) {
        const url = pendingUrl;
        pendingUrl = null;
        await openInTutorialClarity(url);
      } else {
        console.log(`${DIM}  (No YouTube URL pending — copy one first)${RESET}`);
      }
    }
  });
}

main().catch(console.error);
