# Tutorial Clarity — Clipboard Launcher

A tiny Electron app that sits in your system tray and watches the clipboard.  
When you copy a YouTube URL, it automatically opens it in Tutorial Clarity.

## Setup

```powershell
cd C:\Dev\DevMenu110102025\TC\tutorial-clarity\electron-launcher
npm install
```

## Run

Make sure Tutorial Clarity is already running (`npm run dev` in the main project folder), then:

```powershell
npm start
```

A small blue icon will appear in your system tray (bottom-right of taskbar).

## How It Works

1. Copy any YouTube URL (from your browser, a chat, a document, etc.)
2. The launcher detects it and opens Tutorial Clarity with that video
3. Right-click the tray icon to pause/resume or quit

## Tray Menu Options

- **✅ Watching Clipboard** — Toggle clipboard monitoring on/off
- **📊 URLs opened** — Count of videos opened this session
- **🌐 Open Tutorial Clarity** — Open the main app in your browser
- **❌ Quit** — Exit the launcher
