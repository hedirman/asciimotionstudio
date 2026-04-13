const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const root = __dirname;
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const maxJsonBytes = 250 * 1024 * 1024;
const maxUploadBytes = 1024 * 1024 * 1024;
const preparedVideoTtlMs = 60 * 60 * 1000;
const tempRoot = path.join(os.tmpdir(), "ascii-motion-studio");
const preparedVideoRoot = path.join(tempRoot, "prepared-videos");
const preparedVideos = new Map();

fs.mkdirSync(preparedVideoRoot, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4"
};

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    ...extraHeaders
  });
  res.end(body);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  send(res, statusCode, JSON.stringify(payload), "application/json; charset=utf-8", extraHeaders);
}

function sendFile(filePath, res, contentType = null, extraHeaders = {}) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      send(res, 500, "Could not read file.");
    });

    res.writeHead(200, {
      "Content-Type": contentType || mimeTypes[ext] || "application/octet-stream",
      "Content-Length": stats.size,
      ...extraHeaders
    });
    stream.pipe(res);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxJsonBytes) {
        reject(new Error("Export payload is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function streamRequestToFile(req, destinationPath, maxBytes) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationPath);
    let totalBytes = 0;
    let settled = false;

    const finish = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      output.destroy();
      if (error) {
        fs.rmSync(destinationPath, { force: true });
        reject(error);
        return;
      }
      resolve({ bytesWritten: totalBytes });
    };

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        finish(new Error("Uploaded video is too large."));
        req.destroy();
        return;
      }

      if (!output.write(chunk)) {
        req.pause();
      }
    });

    output.on("drain", () => {
      req.resume();
    });

    req.on("end", () => {
      output.end(() => {
        if (!totalBytes) {
          finish(new Error("No video payload was received."));
          return;
        }
        finish();
      });
    });

    req.on("error", (error) => {
      finish(error);
    });

    output.on("error", (error) => {
      finish(error);
    });
  });
}

async function ensureDir(directoryPath) {
  await fs.promises.mkdir(directoryPath, { recursive: true });
}

async function exportMp4(payload) {
  const { frames, fps, width, height, filename } = payload;

  if (!Array.isArray(frames) || !frames.length) {
    throw new Error("No frames were provided for export.");
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("A valid FPS value is required.");
  }

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Valid export dimensions are required.");
  }

  const safeFilename = sanitizeBaseName(filename || "ascii-animation");
  const requestRoot = await fs.promises.mkdtemp(path.join(tempRoot, "ascii-motion-export-"));
  const framesDir = path.join(requestRoot, "frames");
  const outputPath = path.join(requestRoot, `${safeFilename}.mp4`);
  await ensureDir(framesDir);

  try {
    await Promise.all(
      frames.map(async (frame, index) => {
        const match = String(frame).match(/^data:image\/png;base64,(.+)$/);
        if (!match) {
          throw new Error("Each frame must be a PNG data URL.");
        }

        const framePath = path.join(framesDir, `frame-${String(index).padStart(6, "0")}.png`);
        await fs.promises.writeFile(framePath, Buffer.from(match[1], "base64"));
      })
    );

    await runExportFfmpeg({
      fps,
      width,
      height,
      framesDir,
      outputPath
    });

    return {
      buffer: await fs.promises.readFile(outputPath),
      filename: `${safeFilename}.mp4`
    };
  } finally {
    await fs.promises.rm(requestRoot, { recursive: true, force: true });
  }
}

function runExportFfmpeg({ fps, width, height, framesDir, outputPath }) {
  return runCommand("ffmpeg", [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(framesDir, "frame-%06d.png"),
    "-vf",
    `scale=${width}:${height}:flags=neighbor:in_range=full:out_range=full,format=yuv444p`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv444p",
    "-color_range",
    "pc",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-preset",
    "veryslow",
    "-qp",
    "0",
    "-tune",
    "animation",
    "-movflags",
    "+faststart+write_colr",
    outputPath
  ]).then(() => undefined);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      reject(new Error(`${command} could not be started.`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
    });
  });
}

function sanitizeBaseName(value) {
  return String(value || "ascii-animation")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "ascii-animation";
}

function detectExtension(filename, fallback = ".mp4") {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (!ext || ext.length > 10) {
    return fallback;
  }
  return ext;
}

function parseFps(value) {
  if (!value || value === "0/0") {
    return 0;
  }

  const [numeratorText, denominatorText] = String(value).split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText || 1);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(3));
}

function summarizeProbe(raw) {
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const format = raw.format || {};
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  return {
    container: format.format_long_name || format.format_name || "unknown",
    duration: Number(format.duration) || 0,
    sizeBytes: Number(format.size) || 0,
    video: videoStream
      ? {
          codec: videoStream.codec_name || "unknown",
          profile: videoStream.profile || "unknown",
          pixelFormat: videoStream.pix_fmt || "unknown",
          width: Number(videoStream.width) || 0,
          height: Number(videoStream.height) || 0,
          fps: parseFps(videoStream.avg_frame_rate || videoStream.r_frame_rate)
        }
      : null,
    audio: audioStream
      ? {
          codec: audioStream.codec_name || "unknown",
          sampleRate: Number(audioStream.sample_rate) || 0,
          channels: Number(audioStream.channels) || 0
        }
      : null
  };
}

async function probeVideo(filePath) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);
  return summarizeProbe(JSON.parse(stdout || "{}"));
}

function tailText(value, lineCount = 8) {
  return String(value || "")
    .trim()
    .split(/\r?\n/)
    .slice(-lineCount)
    .join("\n");
}

async function normalizeUploadedVideo({ inputPath, outputPath }) {
  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath
  ];

  const result = await runCommand("ffmpeg", args);
  return {
    tool: "ffmpeg",
    videoCodec: "libx264",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    stderrTail: tailText(result.stderr),
    command: `ffmpeg ${args.join(" ")}`
  };
}

async function cleanupExpiredPreparedVideos() {
  const now = Date.now();
  const removals = [];

  preparedVideos.forEach((entry, id) => {
    if (now - entry.createdAt <= preparedVideoTtlMs) {
      return;
    }

    preparedVideos.delete(id);
    removals.push(fs.promises.rm(entry.requestRoot, { recursive: true, force: true }));
  });

  await Promise.allSettled(removals);
}

async function prepareVideo(req) {
  await cleanupExpiredPreparedVideos();

  const requestId = randomUUID();
  const requestRoot = path.join(preparedVideoRoot, requestId);
  await ensureDir(requestRoot);

  const sourceName = String(req.headers["x-file-name"] || "upload-video.mp4");
  const safeBaseName = sanitizeBaseName(sourceName);
  const sourceExt = detectExtension(sourceName);
  const inputPath = path.join(requestRoot, `${safeBaseName}${sourceExt}`);
  const outputPath = path.join(requestRoot, `${safeBaseName}-normalized.mp4`);

  try {
    await streamRequestToFile(req, inputPath, maxUploadBytes);
    const inputProbe = await probeVideo(inputPath);
    const ffmpeg = await normalizeUploadedVideo({ inputPath, outputPath });
    const outputProbe = await probeVideo(outputPath);

    preparedVideos.set(requestId, {
      createdAt: Date.now(),
      requestRoot,
      outputPath,
      filename: `${safeBaseName}-normalized.mp4`,
      diagnostics: {
        input: inputProbe,
        output: outputProbe,
        ffmpeg
      }
    });

    return {
      videoUrl: `/api/prepared-videos/${requestId}`,
      diagnostics: {
        input: inputProbe,
        output: outputProbe,
        ffmpeg
      }
    };
  } catch (error) {
    await fs.promises.rm(requestRoot, { recursive: true, force: true });
    throw error;
  }
}

function getPreparedVideo(id) {
  const entry = preparedVideos.get(id);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.createdAt > preparedVideoTtlMs) {
    preparedVideos.delete(id);
    fs.promises.rm(entry.requestRoot, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  return entry;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/api/export-mp4") {
      try {
        const payload = await readJsonBody(req);
        const result = await exportMp4(payload);
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Content-Length": result.buffer.length
        });
        res.end(result.buffer);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/prepare-video") {
      try {
        const result = await prepareVideo(req);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/prepared-videos/")) {
      const preparedId = pathname.slice("/api/prepared-videos/".length);
      const entry = getPreparedVideo(preparedId);
      if (!entry) {
        send(res, 404, "Prepared video not found.");
        return;
      }

      sendFile(entry.outputPath, res, "video/mp4", {
        "Content-Disposition": `inline; filename="${entry.filename}"`
      });
      return;
    }

    const safePath = path.normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(root, safePath);

    if (!filePath.startsWith(root)) {
      send(res, 403, "Forbidden");
      return;
    }

    sendFile(filePath, res);
  })
  .listen(port, host, () => {
    console.log(`Video to ASCII Studio running at http://${host}:${port}`);
  });
