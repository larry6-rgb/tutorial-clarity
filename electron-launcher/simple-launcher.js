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
import { execSync } from 'child_process';
import { platform } from 'os';

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL_MS = 500;          // poll every 500ms (was 1500)
const DIAG_POLLS = 20;                 // first 20 polls show verbose output
// ────────────────────────────────────────────────────────────────────

let lastClipboard = '';
let pendingUrl = null;
let urlCount = 0;
let pollNumber = 0;
let useClipboardy = true;              // will fall back to PowerShell if clipboardy fails

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

// ── Clipboard Reading (with Windows fallback) ───────────────────────

function readClipboardDirect() {
  // Direct PowerShell / pbpaste / xclip fallback
  const os = platform();
  try {
    if (os === 'win32') {
      return execSync('powershell -NoProfile -Command "Get-Clipboard"', {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      }).trim();
    } else if (os === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf8', timeout: 3000 }).trim();
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 3000 }).trim();
    }
  } catch (err) {
    return null;
  }
}

function readClipboard() {
  // Try clipboardy first, fall back to direct shell command
  if (useClipboardy) {
    try {
      return clipboardy.readSync().trim();
    } catch (err) {
      console.log(`${DIM}  ⚠ clipboardy failed: ${err.message} — switching to direct mode${RESET}`);
      useClipboardy = false;
      // Fall through to direct read
    }
  }
  return readClipboardDirect();
}

// ── Console UI ──────────────────────────────────────────────────────

function showBanner() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║     🎯 Tutorial Clarity — Clipboard Launcher     ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═══════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`${DIM}  Platform: ${platform()}${RESET}`);
  console.log(`${DIM}  Polling every ${POLL_INTERVAL_MS}ms${RESET}`);
  console.log(`${DIM}  (First ${DIAG_POLLS} polls show diagnostic output)${RESET}`);
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
  pollNumber++;
  const isDiag = pollNumber <= DIAG_POLLS;
  
  try {
    const current = readClipboard();
    
    if (current === null) {
      if (isDiag) console.log(`${DIM}  [poll #${pollNumber}] clipboard read returned null${RESET}`);
      return;
    }

    const changed = current !== lastClipboard;
    const preview = current.substring(0, 80).replace(/\n/g, '\\n');
    
    if (isDiag) {
      const method = useClipboardy ? 'clipboardy' : 'direct';
      if (changed) {
        console.log(`${DIM}  [poll #${pollNumber}] (${method}) CHANGED → "${preview}"${RESET}`);
      } else {
        console.log(`${DIM}  [poll #${pollNumber}] (${method}) same${RESET}`);
      }
    }

    if (changed) {
      lastClipboard = current;
      const ytUrl = extractYouTubeUrl(current);
      if (ytUrl) {
        if (ytUrl !== pendingUrl) {
          if (isDiag) console.log(`${DIM}  [poll #${pollNumber}] ✓ YouTube match: ${ytUrl}${RESET}`);
          pendingUrl = ytUrl;
          showStep1(ytUrl);
        }
      } else if (isDiag) {
        console.log(`${DIM}  [poll #${pollNumber}] ✗ Not a YouTube URL${RESET}`);
      }
    }
    
    // End of diagnostic window
    if (pollNumber === DIAG_POLLS) {
      console.log('');
      console.log(`${DIM}  ── Diagnostic output complete. Polling silently now. ──${RESET}`);
      console.log(`${DIM}  (Clipboard reads are working. Copy a YouTube URL!)${RESET}`);
      console.log('');
    }
  } catch (err) {
    console.error(`${DIM}  [poll #${pollNumber}] ❌ Error: ${err.message}${RESET}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  showBanner();

  // Capture current clipboard so we don't trigger on pre-existing content
  const initial = readClipboard();
  lastClipboard = initial || '';
  const initPreview = (initial || '(empty)').substring(0, 80).replace(/\n/g, '\\n');
  console.log(`${DIM}  Initial clipboard: "${initPreview}"${RESET}`);
  console.log('');

  // Start clipboard polling
  const pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);

  // ── Keypress handling (raw mode ONLY, no readline) ──
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
    // Non-TTY fallback: just use process.stdin line events
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
