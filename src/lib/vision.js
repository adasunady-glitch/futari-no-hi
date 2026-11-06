// 顔検出と画像分類。MediaPipe を端末内で動かすので、解析のために写真を外部へ送らない。
// 読み込みに失敗しても呼び出し側は明るさとピントだけで選定を続けられる。
const TASKS_VERSION = '0.10.14';
const TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const CLASSIFIER_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite';

const FOOD_LABELS = new Set([
  'plate', 'menu', 'restaurant', 'soup bowl', 'consomme', 'hot pot', 'trifle', 'ice cream', 'ice lolly',
  'french loaf', 'bagel', 'pretzel', 'cheeseburger', 'hotdog', 'mashed potato', 'guacamole', 'carbonara',
  'chocolate sauce', 'dough', 'meat loaf', 'pizza', 'potpie', 'burrito', 'espresso', 'eggnog', 'red wine',
  'wok', 'frying pan', 'dining table', 'tray', 'mixing bowl', 'coffee mug', 'cup', 'strawberry', 'orange',
  'lemon', 'fig', 'pineapple', 'banana', 'pomegranate', 'mushroom', 'broccoli', 'head cabbage',
  'cauliflower', 'bell pepper', 'cucumber', 'butternut squash', 'zucchini', 'spaghetti squash',
]);

const SCENERY_LABELS = new Set([
  'seashore', 'lakeside', 'alp', 'valley', 'cliff', 'volcano', 'promontory', 'sandbar', 'coral reef',
  'geyser', 'breakwater', 'dock', 'pier', 'boathouse', 'palace', 'castle', 'monastery', 'church', 'mosque',
  'bell cote', 'suspension bridge', 'steel arch bridge', 'viaduct', 'lighthouse', 'beacon', 'fountain',
  'greenhouse', 'park bench', 'stupa', 'dome', 'obelisk', 'triumphal arch', 'wreck', 'canoe', 'gondola',
  'cliff dwelling', 'megalith', 'worm fence', 'stone wall', 'water tower',
]);

const LABEL_THRESHOLD = 0.12;

let loading = null;

async function load() {
  const { FilesetResolver, FaceDetector, ImageClassifier } = await import(`${TASKS_BASE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_BASE}/wasm`);
  const faceDetector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL },
    minDetectionConfidence: 0.55,
  });
  const classifier = await ImageClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: CLASSIFIER_MODEL },
    maxResults: 5,
    scoreThreshold: 0.04,
  });
  return { faceDetector, classifier };
}

export function loadVision() {
  loading ??= load().catch((error) => {
    console.warn('画像認識を読み込めませんでした', error);
    return null;
  });
  return loading;
}

export function categoryFromLabels(labels) {
  let food = 0;
  let scenery = 0;
  for (const { name, score } of labels) {
    if (FOOD_LABELS.has(name)) food += score;
    if (SCENERY_LABELS.has(name)) scenery += score;
  }
  if (food >= LABEL_THRESHOLD && food >= scenery) return 'food';
  if (scenery >= LABEL_THRESHOLD) return 'scenery';
  return null;
}

// 写真全体の面積に対して小さすぎる顔は、背景に写った他人として数えない。
export function countMainFaces(faces, canvasArea) {
  const areas = faces.map((face) => face.boundingBox.width * face.boundingBox.height);
  const largest = Math.max(0, ...areas);
  return areas.filter((area) => area / canvasArea >= 0.006 && area >= largest * 0.25).length;
}

export function analyzeWithVision(vision, canvas) {
  if (!vision) return { faces: 0, labels: [], visionUsed: false };
  const detected = vision.faceDetector.detect(canvas).detections;
  const faces = countMainFaces(detected, canvas.width * canvas.height);
  const categories = vision.classifier.classify(canvas).classifications[0]?.categories ?? [];
  const labels = categories.map((category) => ({ name: category.categoryName, score: category.score }));
  return { faces, labels, visionUsed: true };
}
