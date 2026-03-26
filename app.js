const elements = {
  videoInput: document.querySelector("#video-input"),
  uploadPrompt: document.querySelector("#upload-prompt"),
  videoMeta: document.querySelector("#video-meta"),
  width: document.querySelector("#width"),
  widthValue: document.querySelector("#width-value"),
  detail: document.querySelector("#detail"),
  detailValue: document.querySelector("#detail-value"),
  fps: document.querySelector("#fps"),
  fpsValue: document.querySelector("#fps-value"),
  brightness: document.querySelector("#brightness"),
  brightnessValue: document.querySelector("#brightness-value"),
  contrast: document.querySelector("#contrast"),
  contrastValue: document.querySelector("#contrast-value"),
  gamma: document.querySelector("#gamma"),
  gammaValue: document.querySelector("#gamma-value"),
  invert: document.querySelector("#invert"),
  useColor: document.querySelector("#use-color"),
  loopButton: document.querySelector("#loop-button"),
  charsetPreset: document.querySelector("#charset-preset"),
  charsetCustom: document.querySelector("#charset-custom"),
  backgroundColor: document.querySelector("#background-color"),
  foregroundColor: document.querySelector("#foreground-color"),
  animatedColor: document.querySelector("#animated-color"),
  playToggleButton: document.querySelector("#play-toggle-button"),
  downloadHtmlButton: document.querySelector("#download-html-button"),
  recordWebmButton: document.querySelector("#record-webm-button"),
  progressFill: document.querySelector("#progress-fill"),
  status: document.querySelector("#status"),
  frameCounter: document.querySelector("#frame-counter"),
  tooltipLayer: document.querySelector("#tooltip-layer"),
  asciiOutput: document.querySelector("#ascii-output"),
  sourceVideo: document.querySelector("#source-video"),
  frameCanvas: document.querySelector("#frame-canvas"),
  recordCanvas: document.querySelector("#record-canvas")
};

const frameContext = elements.frameCanvas.getContext("2d", { willReadFrequently: true });
const recordContext = elements.recordCanvas.getContext("2d");

const state = {
  fileUrl: "",
  frames: [],
  isPlaying: false,
  playbackHandle: 0,
  playbackTimer: 0,
  frameIndex: 0,
  renderToken: 0,
  loopEnabled: true,
  previewHandle: 0,
  previewMode: "empty",
  playbackStartTime: 0,
  playbackStartFrame: 0,
  displayedFrameIndex: -1,
  autoConvertHandle: 0,
  isConverting: false
};

const previewResizeObserver = new ResizeObserver(() => {
  fitAsciiToStage();
});

previewResizeObserver.observe(document.querySelector(".preview-stage"));

const charsets = {
  detailed: "@%#*+=-:. ",
  blocks: "█▓▒░ ",
  terminal: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  minimal: "#*:. "
};

const exportScale = 1;

window.addEventListener("resize", () => {
  scheduleFitAsciiToStage();
});

window.addEventListener("orientationchange", () => {
  scheduleFitAsciiToStage();
});

function updateRangeLabel(input, label, formatter = (value) => value) {
  label.textContent = formatter(input.value);
}

function bindRange(input, label, formatter) {
  const sync = () => updateRangeLabel(input, label, formatter);
  input.addEventListener("input", sync);
  sync();
}

bindRange(elements.width, elements.widthValue);
bindRange(elements.detail, elements.detailValue, (value) => `${value}%`);
bindRange(elements.fps, elements.fpsValue);
bindRange(elements.brightness, elements.brightnessValue);
bindRange(elements.contrast, elements.contrastValue);
bindRange(elements.gamma, elements.gammaValue, (value) => (Number(value) / 100).toFixed(2));

elements.charsetPreset.addEventListener("change", () => {
  if (elements.charsetPreset.value !== "custom") {
    elements.charsetCustom.value = charsets[elements.charsetPreset.value];
  }

  handleSettingsChange();
});

elements.videoInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  loadFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  document.addEventListener(eventName, (event) => {
    event.preventDefault();
  });
});

["dragleave", "drop"].forEach((eventName) => {
  document.addEventListener(eventName, (event) => {
    event.preventDefault();
  });
});

document.querySelector(".upload").addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file && file.type.startsWith("video/")) {
    elements.videoInput.files = event.dataTransfer.files;
    loadFile(file);
  }
});

function closeTooltips() {
  document.querySelectorAll(".info-icon.is-open").forEach((icon) => {
    icon.classList.remove("is-open");
  });
  elements.tooltipLayer.hidden = true;
  elements.tooltipLayer.textContent = "";
  elements.tooltipLayer.style.left = "";
  elements.tooltipLayer.style.width = "";
}

function positionTooltipLayer() {
  const openIcon = document.querySelector(".info-icon.is-open");
  const settingsPanel = document.querySelector(".controls-panel");
  if (!openIcon || !settingsPanel) {
    return;
  }

  const panelRect = settingsPanel.getBoundingClientRect();
  const viewportPadding = 12;
  const width = Math.min(panelRect.width, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(viewportPadding, panelRect.left),
    window.innerWidth - viewportPadding - width
  );

  elements.tooltipLayer.style.left = `${left}px`;
  elements.tooltipLayer.style.width = `${width}px`;
}

function openTooltip(icon) {
  elements.tooltipLayer.textContent = icon.dataset.tooltip || "";
  elements.tooltipLayer.hidden = false;
  icon.classList.add("is-open");
  positionTooltipLayer();
}

document.querySelectorAll(".info-icon").forEach((icon) => {
  icon.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const shouldOpen = !icon.classList.contains("is-open");
    closeTooltips();
    if (shouldOpen) {
      openTooltip(icon);
    }
  });
});

document.addEventListener("click", () => {
  closeTooltips();
});

window.addEventListener("resize", positionTooltipLayer);
window.addEventListener("scroll", positionTooltipLayer, { passive: true });

[elements.backgroundColor, elements.foregroundColor, elements.animatedColor].forEach((input) => {
  input.addEventListener("input", () => {
    applyPreviewColors();
    handleSettingsChange();
  });
});

[
  elements.width,
  elements.detail,
  elements.brightness,
  elements.contrast,
  elements.gamma,
  elements.invert,
  elements.useColor,
  elements.charsetCustom
].forEach((input) => {
  const eventName = input.tagName === "INPUT" && input.type === "text" ? "input" : "input";
  input.addEventListener(eventName, handleSettingsChange);
});

elements.fps.addEventListener("input", () => {
  if (state.frames.length) {
    setStatus("FPS changed. Convert again to rebuild the full animation timing.");
  }
});

elements.loopButton.addEventListener("click", () => {
  state.loopEnabled = !state.loopEnabled;
  syncLoopButton();
});

elements.playToggleButton.addEventListener("click", () => {
  if (state.isPlaying) {
    stopPlayback();
    return;
  }

  startPlayback();
});

elements.downloadHtmlButton.addEventListener("click", () => {
  if (!state.frames.length) {
    return;
  }

  const html = createStandalonePlayer();
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), "ascii-animation.html");
});

elements.recordWebmButton.addEventListener("click", async () => {
  if (!state.frames.length) {
    return;
  }

  elements.recordWebmButton.disabled = true;

  try {
    const blob = await exportMp4();
    downloadBlob(blob, "ascii-animation.mp4");
    setStatus("MP4 export complete.");
  } catch (error) {
    console.error(error);
    setStatus(`MP4 export failed: ${error.message}`);
  } finally {
    elements.recordWebmButton.disabled = false;
  }
});

function setStatus(message) {
  elements.status.textContent = message;
}

function setFrameCounter(message = "") {
  elements.frameCounter.textContent = message;
}

function setPlaybackButtons(enabled) {
  elements.playToggleButton.disabled = !enabled;
  elements.playToggleButton.textContent = state.isPlaying ? "Pause" : "Play";
  elements.playToggleButton.setAttribute("data-state", state.isPlaying ? "pause" : "play");
}

function loadFile(file) {
  document.querySelector(".upload")?.classList.add("has-file");

  if (state.fileUrl) {
    URL.revokeObjectURL(state.fileUrl);
  }

  stopPlayback();
  state.frames = [];
  state.frameIndex = 0;
  state.displayedFrameIndex = -1;
  state.previewMode = "live";
  elements.downloadHtmlButton.disabled = true;
  elements.recordWebmButton.disabled = true;
  setPlaybackButtons(false);
  elements.uploadPrompt.textContent = "";

  state.fileUrl = URL.createObjectURL(file);
  elements.sourceVideo.src = state.fileUrl;
  elements.sourceVideo.loop = state.loopEnabled;
  elements.sourceVideo.muted = true;
  elements.sourceVideo.playsInline = true;
  elements.sourceVideo.setAttribute("playsinline", "");
  elements.sourceVideo.setAttribute("webkit-playsinline", "true");
  elements.sourceVideo.load();

  elements.sourceVideo.onloadedmetadata = async () => {
    elements.videoMeta.textContent = `${file.name} • ${elements.sourceVideo.videoWidth}×${elements.sourceVideo.videoHeight} • ${elements.sourceVideo.duration.toFixed(2)}s`;

    try {
      await prepareVideoForFrameExtraction();
      await renderLivePreview(0);
      scheduleAutoConvert("initial");
      setStatus("Video ready. Building the ASCII animation...");
    } catch (error) {
      console.error(error);
      setStatus(`Video loaded, but preview could not start: ${error.message}`);
    }
  };
}

async function prepareVideoForFrameExtraction() {
  const video = elements.sourceVideo;

  if (!video.src) {
    return;
  }

  if (video.readyState < 2) {
    await waitForVideoEvent(video, "loadeddata");
  }

  // iOS Safari is more reliable at frame seeking after a muted inline play/pause cycle.
  try {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }
    video.pause();
  } catch (error) {
    // Ignore autoplay restrictions here; metadata/data may still be usable for seeking.
  }
}

function getSettings() {
  const custom = elements.charsetCustom.value;
  const preset = elements.charsetPreset.value;
  const fullCharacters = (preset === "custom" ? custom : charsets[preset] || custom).replace(/\r?\n/g, "") || "@#S%?*+;:,. ";
  const characters = getDetailCharacters(fullCharacters, Number(elements.detail.value));

  return {
    width: Number(elements.width.value),
    detail: Number(elements.detail.value),
    fps: Number(elements.fps.value),
    brightness: Number(elements.brightness.value),
    contrast: Number(elements.contrast.value) / 100,
    gamma: Number(elements.gamma.value) / 100,
    invert: elements.invert.checked,
    useColor: elements.useColor.checked,
    characters,
    backgroundColor: elements.backgroundColor.value,
    foregroundColor: elements.foregroundColor.value,
    animatedColor: elements.animatedColor.value
  };
}

async function convertVideo() {
  const token = ++state.renderToken;
  const settings = getSettings();
  const video = elements.sourceVideo;
  const duration = video.duration;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("The selected video does not have a readable duration.");
  }

  const frameCount = Math.max(1, Math.floor(duration * settings.fps));
  const { sampleWidth, sampleHeight } = getSampleDimensions(settings, video);
  elements.frameCanvas.width = sampleWidth;
  elements.frameCanvas.height = sampleHeight;

  setStatus(`Converting ${frameCount} frames...`);
  elements.progressFill.style.width = "0%";
  setFrameCounter("");

  for (let index = 0; index < frameCount; index += 1) {
    if (token !== state.renderToken) {
      throw new Error("Conversion interrupted.");
    }

    const time = Math.min(duration, index / settings.fps);
    await seekVideo(video, time);
    frameContext.drawImage(video, 0, 0, sampleWidth, sampleHeight);

    const imageData = frameContext.getImageData(0, 0, sampleWidth, sampleHeight);
    const frame = imageDataToAscii(imageData, settings);
    state.frames.push(frame);

    const progress = ((index + 1) / frameCount) * 100;
    elements.progressFill.style.width = `${progress}%`;
    setStatus(`Captured ${index + 1} / ${frameCount} frames`);
  }

  setStatus(`${state.frames.length} frames ready at ${settings.fps} FPS.`);
  state.previewMode = "animation";
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }

    const handleSeeked = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("The video frame could not be decoded."));
    };

    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });

    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(new Error("This browser could not seek through the selected video."));
    }
  });
}

function imageDataToAscii(imageData, settings) {
  const { width, height, data } = imageData;
  const textLines = [];
  const htmlLines = [];
  const colorRows = [];
  const characters = settings.characters;
  const lastIndex = Math.max(1, characters.length - 1);

  for (let y = 0; y < height; y += 1) {
    let textLine = "";
    let htmlLine = "";
    const colorRow = [];

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];

      const luminance = applyAdjustments((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255, settings);
      const index = Math.round((settings.invert ? luminance : 1 - luminance) * lastIndex);
      const character = characters[Math.max(0, Math.min(lastIndex, index))] || " ";
      const animatedCutoff = Math.max(1, Math.floor(lastIndex * 0.45));
      const isAnimated = character !== " " && index <= animatedCutoff;
      const color = isAnimated ? settings.animatedColor : settings.foregroundColor;

      textLine += character;
      colorRow.push({ character, color });
      if (settings.useColor) {
        htmlLine += `<span style="color:${color}">${escapeHtml(character)}</span>`;
      } else {
        htmlLine += escapeHtml(character);
      }
    }

    textLines.push(textLine);
    htmlLines.push(htmlLine);
    colorRows.push(colorRow);
  }

  return {
    text: textLines.join("\n"),
    html: htmlLines.join("\n"),
    colorRows
  };
}

function applyAdjustments(value, settings) {
  const brightened = value + settings.brightness / 255;
  const contrasted = (brightened - 0.5) * settings.contrast + 0.5;
  const clamped = Math.min(1, Math.max(0, contrasted));
  return Math.pow(clamped, 1 / Math.max(0.01, settings.gamma));
}

function renderFrame(index) {
  const frame = state.frames[index];
  if (!frame) {
    return;
  }

  state.frameIndex = index;
  state.displayedFrameIndex = index;
  applyPreviewColors();

  const useColor = elements.useColor.checked;

  if (useColor) {
    elements.asciiOutput.classList.add("color");
    elements.asciiOutput.innerHTML = frame.html;
  } else {
    elements.asciiOutput.classList.remove("color");
    elements.asciiOutput.textContent = frame.text;
  }

  scheduleFitAsciiToStage(frame.text);
}

async function renderLivePreview(time = null) {
  const video = elements.sourceVideo;
  if (!video.src || !video.videoWidth || !video.videoHeight) {
    return;
  }

  const settings = getSettings();
  const previewTime = time ?? Math.min(video.currentTime || 0, Math.max(0, video.duration - 0.001));
  const { sampleWidth, sampleHeight } = getSampleDimensions(settings, video);
  elements.frameCanvas.width = sampleWidth;
  elements.frameCanvas.height = sampleHeight;

  await seekVideo(video, previewTime);
  frameContext.drawImage(video, 0, 0, sampleWidth, sampleHeight);
  const imageData = frameContext.getImageData(0, 0, sampleWidth, sampleHeight);
  const frame = imageDataToAscii(imageData, settings);
  state.previewMode = "live";

  applyPreviewColors();
  if (settings.useColor) {
    elements.asciiOutput.classList.add("color");
    elements.asciiOutput.innerHTML = frame.html;
  } else {
    elements.asciiOutput.classList.remove("color");
    elements.asciiOutput.textContent = frame.text;
  }

  scheduleFitAsciiToStage(frame.text);
}

function startPlayback() {
  if (!state.frames.length || state.isPlaying) {
    return;
  }

  const fps = Number(elements.fps.value);
  state.isPlaying = true;
  state.playbackStartFrame = state.frameIndex;
  state.playbackStartTime = performance.now();
  setPlaybackButtons(true);

  const frameDelay = 1000 / Math.max(1, fps);

  const tick = () => {
    if (!state.isPlaying) {
      return;
    }

    const elapsedFrames = Math.floor((performance.now() - state.playbackStartTime) / frameDelay);
    let nextFrame = state.playbackStartFrame + elapsedFrames;

    if (state.loopEnabled) {
      nextFrame %= state.frames.length;
    } else if (nextFrame >= state.frames.length) {
      nextFrame = state.frames.length - 1;
      if (state.displayedFrameIndex !== nextFrame) {
        renderFrame(nextFrame);
      }
      state.frameIndex = nextFrame;
      stopPlayback();
      return;
    }

    if (state.displayedFrameIndex !== nextFrame) {
      renderFrame(nextFrame);
    }

    state.frameIndex = nextFrame;
    const nextExpectedFrame = elapsedFrames + 1;
    const nextTargetTime = state.playbackStartTime + nextExpectedFrame * frameDelay;
    const delayUntilNextFrame = Math.max(0, nextTargetTime - performance.now());
    state.playbackTimer = window.setTimeout(tick, delayUntilNextFrame);
  };

  if (state.displayedFrameIndex !== state.frameIndex) {
    renderFrame(state.frameIndex);
  }
  state.playbackTimer = window.setTimeout(tick, frameDelay);
  setStatus(`Playback running at ${fps} FPS.`);
}

function stopPlayback() {
  state.isPlaying = false;
  window.cancelAnimationFrame(state.playbackHandle);
  state.playbackHandle = 0;
  window.clearTimeout(state.playbackTimer);
  state.playbackTimer = 0;
  setPlaybackButtons(!!state.frames.length);
}

function scheduleFitAsciiToStage(frameText = "") {
  fitAsciiToStage(frameText);
  window.requestAnimationFrame(() => {
    fitAsciiToStage(frameText);
  });
  window.setTimeout(() => {
    fitAsciiToStage(frameText);
  }, 0);
}

function queueLivePreview(time = null) {
  window.clearTimeout(state.previewHandle);
  state.previewHandle = window.setTimeout(async () => {
    try {
      await renderLivePreview(time);
    } catch (error) {
      console.error(error);
    }
  }, 60);
}

function handleSettingsChange() {
  applyPreviewColors();

  if (!elements.sourceVideo.src) {
    return;
  }

  if (state.frames.length) {
    stopPlayback();
    state.frames = [];
    state.frameIndex = 0;
    state.displayedFrameIndex = -1;
    setPlaybackButtons(false);
    elements.downloadHtmlButton.disabled = true;
    elements.recordWebmButton.disabled = true;
  }

  queueLivePreview();
  scheduleAutoConvert("settings");
  setStatus("Preview updated. Rebuilding the ASCII animation...");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createStandalonePlayer() {
  const payload = {
    frames: state.frames.map((frame) => frame.html),
    textFrames: state.frames.map((frame) => frame.text),
    fps: Number(elements.fps.value),
    color: elements.useColor.checked,
    backgroundColor: elements.backgroundColor.value,
    foregroundColor: elements.foregroundColor.value,
    animatedColor: elements.animatedColor.value
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ASCII Animation</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: ${JSON.stringify(payload.backgroundColor)};
      color: ${JSON.stringify(payload.foregroundColor)};
      font-family: "IBM Plex Mono", Consolas, monospace;
    }
    pre {
      margin: 0;
      padding: 20px;
      line-height: 0.72;
      font-size: 9px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      overflow: auto;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
    }
    span { white-space: pre; }
  </style>
</head>
<body>
  <pre id="output"></pre>
  <script>
    const payload = ${JSON.stringify(payload)};
    const output = document.querySelector("#output");
    let index = 0;
    const render = () => {
      if (payload.color) {
        output.innerHTML = payload.frames[index];
      } else {
        output.textContent = payload.textFrames[index];
      }
      index = (index + 1) % payload.frames.length;
    };
    render();
    window.setInterval(render, 1000 / payload.fps);
  </script>
</body>
</html>`;
}

async function exportMp4() {
  const frame = state.frames[0];
  const video = elements.sourceVideo;
  if (!frame || !video.videoWidth || !video.videoHeight) {
    throw new Error("There are no rendered frames ready for export.");
  }

  const fps = Number(elements.fps.value);
  const { width, height } = getExportDimensions(video.videoWidth, video.videoHeight);
  const pngFrames = [];

  elements.recordCanvas.width = width;
  elements.recordCanvas.height = height;

  for (let index = 0; index < state.frames.length; index += 1) {
    drawFrameToExportCanvas(state.frames[index], width, height);
    pngFrames.push(elements.recordCanvas.toDataURL("image/png"));

    if (index % 5 === 0) {
      setStatus(`Preparing MP4 frames ${index + 1}/${state.frames.length}...`);
      await nextFrame();
    }
  }

  setStatus("Encoding high-quality MP4 with ffmpeg...");

  const response = await fetch("/api/export-mp4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      frames: pngFrames,
      fps,
      width,
      height,
      filename: getExportFilename()
    })
  });

  if (!response.ok) {
    let message = "The server could not export the MP4.";
    try {
      const payload = await response.json();
      if (payload.error) {
        message = payload.error;
      }
    } catch (error) {
      // Ignore JSON parse failures and use the generic message.
    }
    throw new Error(message);
  }

  return response.blob();
}

function drawFrameToExportCanvas(frame, width, height) {
  const metrics = getCanvasRenderMetrics(frame.text, width, height);
  recordContext.fillStyle = elements.backgroundColor.value;
  recordContext.fillRect(0, 0, width, height);
  recordContext.font = `${metrics.fontSize}px "IBM Plex Mono", Consolas, monospace`;
  recordContext.textBaseline = "top";

  if (elements.useColor.checked && frame.colorRows) {
    frame.colorRows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (cell.character === " ") {
          return;
        }

        recordContext.fillStyle = cell.color;
        recordContext.fillText(
          cell.character,
          metrics.offsetX + columnIndex * metrics.characterWidth,
          metrics.offsetY + rowIndex * metrics.lineAdvance
        );
      });
    });
    return;
  }

  recordContext.fillStyle = elements.foregroundColor.value;
  const lines = frame.text.split("\n");
  lines.forEach((line, index) => {
    recordContext.fillText(line, metrics.offsetX, metrics.offsetY + index * metrics.lineAdvance);
  });
}

function getCanvasRenderMetrics(frameText, width, height) {
  const lines = frameText.split("\n");
  const columns = Math.max(1, ...lines.map((line) => line.length));
  const rows = Math.max(1, lines.length);
  const charWidthRatio = 0.62;
  const lineHeightRatio = 0.72;
  const fontSize = Math.max(4, Math.min(width / (columns * charWidthRatio), height / (rows * lineHeightRatio)));
  const characterWidth = fontSize * charWidthRatio;
  const lineAdvance = fontSize * lineHeightRatio;
  const contentWidth = columns * characterWidth;
  const contentHeight = rows * lineAdvance;

  return {
    fontSize,
    characterWidth,
    lineAdvance,
    offsetX: Math.max(0, (width - contentWidth) / 2),
    offsetY: Math.max(0, (height - contentHeight) / 2)
  };
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function getExportFilename() {
  const inputName = elements.videoInput.files?.[0]?.name || "ascii-animation";
  return inputName.replace(/\.[^/.]+$/, "") + "-ascii";
}

function getExportDimensions(sourceWidth, sourceHeight) {
  return {
    width: Math.round(sourceWidth * exportScale),
    height: Math.round(sourceHeight * exportScale)
  };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyPreviewColors() {
  document.documentElement.style.setProperty("--preview-background", elements.backgroundColor.value);
  elements.asciiOutput.style.backgroundColor = elements.backgroundColor.value;
  elements.asciiOutput.style.color = elements.useColor.checked
    ? elements.animatedColor.value
    : elements.foregroundColor.value;
}

applyPreviewColors();
syncLoopButton();

function fitAsciiToStage(frameText = "") {
  const stage = document.querySelector(".preview-stage");
  if (!stage) {
    return;
  }

  const text = frameText || elements.asciiOutput.textContent || "";
  const lines = text.split("\n");
  const columns = Math.max(1, ...lines.map((line) => line.length));
  const rows = Math.max(1, lines.length);
  const stageStyle = window.getComputedStyle(stage);
  const horizontalPadding = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
  const verticalPadding = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
  const availableWidth = Math.max(120, stage.clientWidth - horizontalPadding);
  const availableHeight = Math.max(120, stage.clientHeight - verticalPadding);

  const { charWidthRatio, lineHeightRatio } = getDisplayCharacterMetrics();
  const widthLimitedFontSize = availableWidth / (columns * charWidthRatio);
  const heightLimitedFontSize = availableHeight / (rows * lineHeightRatio);
  const fontSize = Math.max(4, Math.min(widthLimitedFontSize, heightLimitedFontSize));

  elements.asciiOutput.style.fontSize = `${fontSize}px`;
  elements.asciiOutput.style.lineHeight = String(lineHeightRatio);
}

function getSampleDimensions(settings, video) {
  const requestedWidth = Math.max(16, Math.floor(settings.width));
  const sampleWidth = Math.min(requestedWidth, Math.max(16, video.videoWidth));
  const aspectRatio = video.videoHeight / video.videoWidth || 1;
  const { charWidthRatio: characterWidthRatio, lineHeightRatio } = getSamplingCharacterMetrics();
  const characterAspectCompensation = characterWidthRatio / lineHeightRatio;
  const requestedHeight = Math.max(12, Math.round(sampleWidth * aspectRatio * characterAspectCompensation));
  const sampleHeight = Math.min(requestedHeight, Math.max(12, video.videoHeight));
  return { sampleWidth, sampleHeight };
}

function getDisplayCharacterMetrics() {
  return {
    charWidthRatio: 0.62,
    lineHeightRatio: 0.72
  };
}

function getSamplingCharacterMetrics() {
  return {
    charWidthRatio: 0.62,
    lineHeightRatio: 0.72
  };
}

function getDetailCharacters(characters, detail) {
  const unique = [...new Set(characters.split(""))];
  const minLength = Math.min(2, unique.length);
  const count = Math.max(minLength, Math.round((detail / 100) * unique.length));
  return unique.slice(0, count).join("");
}

function syncLoopButton() {
  elements.loopButton.textContent = `Loop: ${state.loopEnabled ? "On" : "Off"}`;
  elements.loopButton.setAttribute("aria-pressed", String(state.loopEnabled));
  elements.sourceVideo.loop = state.loopEnabled;
}

function scheduleAutoConvert(reason = "settings") {
  if (!elements.sourceVideo.src) {
    return;
  }

  window.clearTimeout(state.autoConvertHandle);
  const delay = reason === "initial" ? 150 : 280;
  state.autoConvertHandle = window.setTimeout(() => {
    runConversion("auto");
  }, delay);
}

async function runConversion(trigger = "auto") {
  if (!elements.sourceVideo.src || state.isConverting) {
    return;
  }

  window.clearTimeout(state.autoConvertHandle);
  state.isConverting = true;
  stopPlayback();
  state.frames = [];
  state.frameIndex = 0;
  state.displayedFrameIndex = -1;
  elements.downloadHtmlButton.disabled = true;
  elements.recordWebmButton.disabled = true;

  try {
    await prepareVideoForFrameExtraction();
    await convertVideo();
    if (state.frames.length) {
      renderFrame(0);
      setPlaybackButtons(true);
      elements.downloadHtmlButton.disabled = false;
      elements.recordWebmButton.disabled = false;
      startPlayback();
      setStatus(
        trigger === "auto"
          ? `Animation updated automatically with ${state.frames.length} frames.`
          : `Converted ${state.frames.length} ASCII frames.`
      );
    } else {
      setStatus("No frames were generated. Try a different video or settings.");
    }
  } catch (error) {
    console.error(error);
    setStatus(`Conversion failed: ${error.message}`);
  } finally {
    state.isConverting = false;
  }
}

function waitForVideoEvent(video, eventName) {
  return new Promise((resolve, reject) => {
    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("The selected video could not be loaded."));
    };

    const cleanup = () => {
      video.removeEventListener(eventName, handleReady);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener(eventName, handleReady, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}
