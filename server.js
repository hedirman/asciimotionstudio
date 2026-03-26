const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const root = __dirname;
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const maxJsonBytes = 250 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream"
    });
    res.end(data);
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

  const safeFilename = String(filename || "ascii-animation")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "ascii-animation";
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ascii-motion-"));
  const framesDir = path.join(tempRoot, "frames");
  const outputPath = path.join(tempRoot, `${safeFilename}.mp4`);
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

    await runFfmpeg({
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
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

function runFfmpeg({ fps, width, height, framesDir, outputPath }) {
  return new Promise((resolve, reject) => {
    const args = [
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
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", () => {
      reject(new Error("ffmpeg could not be started."));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}.`));
    });
  });
}

http
  .createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/export-mp4") {
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
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    const safePath = path
      .normalize(req.url === "/" ? "/index.html" : req.url)
      .replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(root, safePath);

    if (!filePath.startsWith(root)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    sendFile(filePath, res);
  })
  .listen(port, host, () => {
    console.log(`Video to ASCII Studio running at http://${host}:${port}`);
  });
