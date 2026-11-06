// 座標と地名の変換に OpenStreetMap の Nominatim を使う。利用規約に合わせ、1秒に1回までにする。
const BASE = 'https://nominatim.openstreetmap.org';
const INTERVAL_MS = 1100;

let lastRequest = 0;

async function throttled(url) {
  const wait = lastRequest + INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`地名の取得に失敗しました (${response.status})`);
  return response.json();
}

function placeName(result) {
  const address = result.address ?? {};
  return result.name
    || address.tourism || address.amenity || address.leisure || address.shop || address.building
    || address.neighbourhood || address.quarter || address.suburb || address.city_district
    || address.town || address.city || address.village
    || result.display_name?.split(',')[0]
    || '名前のない場所';
}

export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    lat, lon: lng, format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'ja',
  });
  const result = await throttled(`${BASE}/reverse?${params}`);
  return {
    name: placeName(result),
    kind: [result.category, result.type].filter(Boolean).join(' '),
  };
}

export async function searchPlaces(query) {
  const params = new URLSearchParams({
    q: query, format: 'jsonv2', limit: '5', addressdetails: '1', 'accept-language': 'ja', countrycodes: 'jp',
  });
  const results = await throttled(`${BASE}/search?${params}`);
  return results.map((result) => ({
    name: placeName(result),
    detail: result.display_name,
    kind: [result.category, result.type].filter(Boolean).join(' '),
    lat: Number(result.lat),
    lng: Number(result.lon),
  }));
}
