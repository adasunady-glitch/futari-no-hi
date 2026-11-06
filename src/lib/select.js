// 写真の選定と場所のまとめ方。ブラウザ機能に依存しない純粋な計算だけを置く。

export const CATEGORY_LABELS = {
  two: 'ふたり',
  food: 'ごはん',
  scenery: '風景',
  person: 'ひとり',
  group: 'みんな',
  other: 'スナップ',
};

// 1日分の見返しやすさを優先して、カテゴリごとの上限を決める。
const QUOTAS = { two: 4, food: 3, scenery: 3, group: 2, person: 2, other: 2 };
const ROUND_ORDER = ['two', 'food', 'scenery', 'group', 'person', 'other'];
export const MAX_SELECTED = 12;

const DUPLICATE_HASH_DISTANCE = 10;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export function hammingDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

// 連写や撮り直しをまとめ、各まとまりの最高点だけを残す。残らなかった写真には duplicateOf が付く。
export function markDuplicates(photos) {
  const ordered = [...photos].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const photo of ordered) {
    const twin = kept.find((other) => {
      const close = hammingDistance(photo.hash, other.hash) <= DUPLICATE_HASH_DISTANCE;
      if (!close) return false;
      if (photo.takenAt == null || other.takenAt == null) return true;
      return Math.abs(photo.takenAt - other.takenAt) <= DUPLICATE_WINDOW_MS;
    });
    if (twin) photo.duplicateOf = twin.id;
    else kept.push(photo);
  }
  return photos;
}

// 同じ種類に偏らないよう、カテゴリを順に回して高得点の写真から選ぶ。
export function selectBest(photos, limit = MAX_SELECTED) {
  const usable = photos.filter((photo) => !photo.duplicateOf && !photo.rejectReason);
  const queues = Object.fromEntries(ROUND_ORDER.map((category) => [category, []]));
  for (const photo of [...usable].sort((a, b) => b.score - a.score)) {
    (queues[photo.category] ?? queues.other).push(photo);
  }
  const counts = Object.fromEntries(ROUND_ORDER.map((category) => [category, 0]));
  const selected = [];
  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const category of ROUND_ORDER) {
      if (selected.length >= limit) break;
      if (counts[category] >= QUOTAS[category] || !queues[category].length) continue;
      selected.push(queues[category].shift());
      counts[category] += 1;
      progressed = true;
    }
  }
  // 上限に余りがあれば、カテゴリを問わず点の高い順に埋める。
  const remaining = ROUND_ORDER.flatMap((category) => queues[category]).sort((a, b) => b.score - a.score);
  while (selected.length < limit && remaining.length) selected.push(remaining.shift());
  return selected;
}

export function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// 撮影順にたどり、近い写真を1か所にまとめる。一度離れて戻った場合は別の訪問として残す。
export function clusterPlaces(points, radiusMeters = 300) {
  const ordered = points
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
  const clusters = [];
  for (const point of ordered) {
    const current = clusters[clusters.length - 1];
    if (current && haversineMeters(current, point) <= radiusMeters) {
      current.count += 1;
      current.lat += (point.lat - current.lat) / current.count;
      current.lng += (point.lng - current.lng) / current.count;
    } else {
      clusters.push({ lat: point.lat, lng: point.lng, arrivedAt: point.takenAt ?? null, count: 1 });
    }
  }
  return clusters;
}

// 深夜のまま続いたデートの写真も同じ日に含めるため、翌朝4時未満までを範囲にする。
export function isWithinDay(takenAt, date, endDate) {
  if (takenAt == null) return true;
  const start = new Date(`${date}T00:00:00`).getTime();
  const end = new Date(`${endDate || date}T00:00:00`).getTime() + 28 * 60 * 60 * 1000;
  return takenAt >= start && takenAt < end;
}

export function commentState({ mine, partner, partnerWrote }) {
  if (mine && partner) return 'open';
  if (mine) return 'waiting-partner';
  if (partnerWrote) return 'locked';
  return 'empty';
}
