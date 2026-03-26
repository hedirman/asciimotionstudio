# Ascii Motion Studio

Convert video clips into animated ASCII art directly in the browser.

## Requirements

- Node.js
- npm
- `ffmpeg` on your system path for MP4 export

## Dependencies

- Runtime dependencies: none from npm. The server uses only built-in Node.js modules (`http`, `fs`, `path`, `os`, and `child_process`).
- System dependency: `ffmpeg` is required only for MP4 export.

## Features

- Upload a video and preview the ASCII animation live
- Adjust resolution, detail, contrast, gamma, colors, and playback
- Export as a standalone HTML animation or a high-quality MP4 rendered with server-side ffmpeg

## Run locally

```bash
cd /path/to/AsciiStudio
npm start
```

## Install ffmpeg

```bash
brew install ffmpeg
```
