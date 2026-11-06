// 選ばれた写真ファイルを1枚ずつ解析し、選定の材料と保存用の画像を作る。
import { analyzeWithVision, categoryFromLabels, loadVision } from './vision.js';
import { isWithinDay, markDuplicates, selectBest } from './select.js';

const EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';
const ANALYSIS_SIZE = 640;
const PREVIEW_SIZE = 360;
const FULL_SIZE = 1600;
const THUMB_SIZE = 480;

let exifrModule = null;

async function readMeta(file) {
  try {
    exifrModule ??= await import(EXIFR_URL);
    const exif = await exifrModule.default.parse(file, {
      tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
    });
    const taken = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
    return {
      takenAt: taken instanceof Date ? taken.getTime() : null,
      lat: Number.isFinite(exif?.latitude) ? exif.latitude : null,
      lng: Number.isFinite(exif?.longitude) ? exif.longitude : null,
      hasCamera: Boolean(exif?.Make || exif?.Model),
    };
  } catch (error) {
    console.warn('写真情報を読めませんでした', file.name, error);
    return { takenAt: null, lat: null, lng: null, hasCamera: false };
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} を読み込めませんでした`));
    };
    image.src = url;
  });
}

function drawScaled(image, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// 明るさ、コントラスト、彩度、ピント、代表色を小さな画像から計算する。
export function measurePixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  let sum = 0;
  let squared = 0;
  let saturation = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const value = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = value;
    sum += value;
    squared += value * value;
    const max = Math.max(r, g, b);
    saturation += max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    red += r;
    green += g;
    blue += b;
  }
  const count = width * height;
  const brightness = sum / count / 255;
  const contrast = Math.sqrt(Math.max(0, squared / count - (sum / count) ** 2)) / 128;
  let laplaceSum = 0;
  let laplaceSquared = 0;
  let laplaceCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const value = gray[p - width] + gray[p + width] + gray[p - 1] + gray[p + 1] - 4 * gray[p];
      laplaceSum += value;
      laplaceSquared += value * value;
      laplaceCount += 1;
    }
  }
  const mean = laplaceCount ? laplaceSum / laplaceCount : 0;
  const sharpness = laplaceCount ? laplaceSquared / laplaceCount - mean * mean : 0;
  const hex = (value) => Math.round(value / count).toString(16).padStart(2, '0');
  return {
    brightness,
    contrast,
    saturation: saturation / count,
    sharpness,
    dominant: `#${hex(red)}${hex(green)}${hex(blue)}`,
  };
}

// 9x8 に縮小して隣同士の明暗を比べる。ほぼ同じ構図の写真は近い値になる。
export function differenceHash(source) {
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const gray = (x, y) => {
    const p = (y * 9 + x) * 4;
    return data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  };
  let hash = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) hash += gray(x, y) < gray(x + 1, y) ? '1' : '0';
  }
  return hash;
}

export function scorePhoto({ brightness, contrast, saturation, sharpness, faces, category }) {
  const exposure = 1 - Math.min(1, Math.abs(brightness - 0.5) / 0.5);
  const focus = Math.min(1, Math.log10(1 + sharpness) / 3);
  const tone = Math.min(1, contrast / 0.5);
  const color = Math.min(1, saturation / 0.55);
  let score = 0.4 * focus + 0.3 * exposure + 0.15 * tone + 0.15 * color;
  if (category === 'two') score += 0.25;
  else if (category === 'food' || category === 'scenery') score += 0.1;
  else if (faces > 0) score += 0.1;
  return Math.min(1, score);
}

function categorize(faces, labels) {
  if (faces === 2) return 'two';
  if (faces >= 3) return 'group';
  const fromLabels = categoryFromLabels(labels);
  if (fromLabels) return fromLabels;
  return faces === 1 ? 'person' : 'other';
}

function looksLikeScreenshot(file, meta) {
  return file.type === 'image/png' && !meta.hasCamera;
}

/**
 * 写真を解析して候補を返す。
 * onProgress(終わった枚数, 全体の枚数)
 * 戻り値の selected には初期選択の id が入る。
 */
export async function analyzeFiles(files, entry, onProgress = () => {}) {
  const vision = await loadVision();
  const photos = [];
  const failed = [];
  let outOfDay = 0;
  let index = 0;
  for (const file of files) {
    index += 1;
    const meta = await readMeta(file);
    if (!isWithinDay(meta.takenAt, entry.date, entry.end_date)) {
      outOfDay += 1;
      onProgress(index, files.length);
      continue;
    }
    try {
      const { image, release } = await loadImage(file);
      const canvas = drawScaled(image, ANALYSIS_SIZE);
      const previewCanvas = drawScaled(image, PREVIEW_SIZE);
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      release();
      const pixels = measurePixels(canvas);
      const seen = analyzeWithVision(vision, canvas);
      const category = categorize(seen.faces, seen.labels);
      const photo = {
        id: `${index}-${file.name}`,
        file,
        previewUrl: previewCanvas.toDataURL('image/jpeg', 0.72),
        takenAt: meta.takenAt,
        lat: meta.lat,
        lng: meta.lng,
        width,
        height,
        hash: differenceHash(canvas),
        dominant: pixels.dominant,
        faces: seen.faces,
        labels: seen.labels,
        category,
        score: scorePhoto({ ...pixels, faces: seen.faces, category }),
        rejectReason: looksLikeScreenshot(file, meta) ? 'スクリーンショット' : null,
      };
      photos.push(photo);
    } catch (error) {
      console.warn(error);
      failed.push(file.name);
    }
    onProgress(index, files.length);
    // 解析中も画面が固まらないよう、1枚ごとに描画へ戻す。
    await new Promise((resolve) => setTimeout(resolve));
  }
  markDuplicates(photos);
  const selected = new Set(selectBest(photos).map((photo) => photo.id));
  photos.sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
  return {
    photos,
    selected,
    outOfDay,
    failed,
    visionUsed: Boolean(vision),
    withLocation: photos.filter((photo) => photo.lat != null).length,
  };
}

// 保存用に縮小する。Canvas を通すことで元写真の位置情報は画像から取り除かれる。
export async function preparePhotoForSave(photo) {
  const { image, release } = await loadImage(photo.file);
  const full = await toBlob(drawScaled(image, FULL_SIZE), 0.84);
  const thumb = await toBlob(drawScaled(image, THUMB_SIZE), 0.76);
  release();
  return {
    full,
    thumb,
    category: photo.category,
    score: photo.score,
    taken_at: photo.takenAt ? new Date(photo.takenAt).toISOString() : null,
    dominant: photo.dominant,
    width: photo.width,
    height: photo.height,
  };
}
