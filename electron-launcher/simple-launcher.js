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

import open from 'open';
import { execSync } from 'child_process';
import { platform } from 'os';

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL_MS = 500;
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

// ── Clipboard Reading (native OS commands — no clipboardy) ──────────

function readClipboard() {
  const os = platform();
  try {
    if (os === 'win32') {
      return execSync('powershell.exe -NoProfile -Command "Get-Clipboard"', {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      }).trim();
    } else if (os === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf8', timeout: 3000 }).trim();
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 3000 }).trim();
    }
  } catch {
    return null;
  }
}

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

function showOpened() {
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
    showOpened();
  } catch (err) {
    console.error(`  ❌ Failed to open browser: ${err.message}`);
    console.log(`  📋 Copy this URL manually: ${tcUrl}`);
    console.log('');
  }
}

// ── Clipboard Polling ───────────────────────────────────────────────

function checkClipboard() {
  try {
    const current = readClipboard();
    if (current === null) return;          // read failed, skip this tick

    if (current && current !== lastClipboard) {
      lastClipboard = current;
      const ytUrl = extractYouTubeUrl(current);
      if (ytUrl && ytUrl !== pendingUrl) {
        pendingUrl = ytUrl;
        showStep1(ytUrl);
      }
    }
  } catch (err) {
    // Unexpected error — log once and keep going
    console.error(`${DIM}  ⚠ clipboard poll error: ${err.message}${RESET}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  showBanner();

  // Capture current clipboard so we don't trigger on pre-existing content
  lastClipboard = readClipboard() || '';

  // Start clipboard polling
  const pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);

  // ── Keypress handling ──
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
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
  } else {
    // Non-TTY fallback
    console.log(`${DIM}  (Non-TTY mode — type and press ENTER)${RESET}`);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (chunk) => {
      if (chunk.trim() === '' && pendingUrl) {
        const url = pendingUrl;
        pendingUrl = null;
        await openInTutorialClarity(url);
      }
    });
  }
}

main().catch(console.error);
