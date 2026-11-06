// 日付・時間帯・場所・写真の色から、その日の背景を決める。AIは使わず、結果が説明できるルールにしている。

// 地図データの種類を優先して使う。地名は「代官山」「港区」「吉祥寺」のような街の名前を
// 誤認しやすいので、施設や地形をはっきり示す語だけで判定する。
const THEME_KINDS = {
  aquarium: ['aquarium'],
  sea: ['beach', 'coastline', 'bay', 'marina', 'cape'],
  mountain: ['peak', 'volcano', 'waterfall', 'valley', 'ridge'],
  shrine: ['place_of_worship', 'shrine', 'temple'],
  park: ['park', 'garden', 'zoo', 'nature_reserve'],
};

const THEME_NAME_PATTERNS = {
  aquarium: /水族館/,
  sea: /海岸|海水浴|ビーチ|浜辺|岬|(?<!横)浜$/,
  mountain: /山頂|岳$|高原|峠|渓谷|滝$|富士山|高尾山|登山/,
  shrine: /神社|大社|神宮|稲荷/,
  park: /公園|庭園|植物園|動物園|牧場/,
};

const THEME_NAMES = {
  aquarium: '水族館',
  sea: '海',
  mountain: '山',
  shrine: '社寺',
  park: '緑',
  city: '街',
};

const TIME_NAMES = { morning: '朝', day: '昼下がり', dusk: '夕暮れ', night: '夜' };

const SEASON_TINTS = {
  spring: '#f7b7c8',
  summer: '#7fd4e8',
  autumn: '#e0954f',
  winter: '#a9c2e6',
};

const PALETTES = {
  city: {
    morning: ['#f3dccb', '#eee5de', '#c7d4e6'],
    day: ['#b9c8e0', '#e1e7f1', '#f4e5e6'],
    dusk: ['#232a55', '#6d4a8c', '#e58c8a'],
    night: ['#0d0b1f', '#241a45', '#5a2a63'],
  },
  sea: {
    morning: ['#fbd7c0', '#bfe3ea', '#7cc4d6'],
    day: ['#4fb3d9', '#a6e0e8', '#f5e9cf'],
    dusk: ['#27305f', '#c0566f', '#f7b267'],
    night: ['#050d24', '#0e2a47', '#1d4a63'],
  },
  mountain: {
    morning: ['#e7d9c3', '#b8d4bd', '#7fae9b'],
    day: ['#7fb7a0', '#c5dfc0', '#eef0d6'],
    dusk: ['#3a2c4f', '#96566a', '#e2a36b'],
    night: ['#0b1620', '#142b33', '#2a3f45'],
  },
  park: {
    morning: ['#f2e4c4', '#cfe5bb', '#9ccf9f'],
    day: ['#9ed2a6', '#dcedc1', '#fbf3d5'],
    dusk: ['#3b3358', '#a0627a', '#efb36f'],
    night: ['#0e1b1f', '#1b3331', '#37503f'],
  },
  shrine: {
    morning: ['#eee3d0', '#d9c6ad', '#b79a7f'],
    day: ['#e5dccb', '#d0bea2', '#ad8b70'],
    dusk: ['#36202b', '#8e3b3b', '#d98a56'],
    night: ['#1a0f14', '#3a1c20', '#6b2d2b'],
  },
  aquarium: {
    morning: ['#06283d', '#1363a0', '#47b5c4'],
    day: ['#06283d', '#1363a0', '#47b5c4'],
    dusk: ['#06283d', '#1363a0', '#47b5c4'],
    night: ['#041c2e', '#0d4a7a', '#2b8fa6'],
  },
};

export function seasonOf(dateText) {
  const month = Number(dateText.slice(5, 7));
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

// 日本のおおよその日の入り時刻。月ごとの差を時間帯の判定に反映する。
const SUNSET_BY_MONTH = [17, 17.5, 18, 18.25, 18.75, 19, 19, 18.75, 18, 17.25, 16.75, 16.75];

export function timeOfDay(hour, dateText) {
  const sunset = SUNSET_BY_MONTH[Number(dateText.slice(5, 7)) - 1];
  if (hour < 5 || hour >= sunset + 1) return 'night';
  if (hour < 10) return 'morning';
  if (hour >= sunset - 1.5) return 'dusk';
  return 'day';
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function detectTheme(places) {
  const scores = { aquarium: 0, sea: 0, mountain: 0, shrine: 0, park: 0 };
  for (const place of places) {
    const name = (place.name ?? '').trim();
    const kind = (place.kind ?? '').toLowerCase();
    for (const theme of Object.keys(scores)) {
      const byKind = THEME_KINDS[theme].some((word) => kind.includes(word));
      if (byKind || THEME_NAME_PATTERNS[theme].test(name)) scores[theme] += 1;
    }
  }
  const [best, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return score > 0 ? best : 'city';
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function blend(hexA, hexB, amount) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const mixed = a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chooseParticle(theme, time, season) {
  if (theme === 'aquarium') return 'bubbles';
  if (time === 'night') {
    if (season === 'winter') return 'snow';
    return theme === 'city' ? 'bokeh' : 'stars';
  }
  if (season === 'spring' && ['park', 'shrine', 'city'].includes(theme)) return 'petals';
  if (season === 'autumn' && ['park', 'shrine', 'mountain'].includes(theme)) return 'leaves';
  if (theme === 'sea') return 'sparkle';
  return 'none';
}

// input: { date, hours: number[], places: [{name, kind}], dominant?: '#rrggbb' }
export function computeMood({ date, hours = [], places = [], dominant = null }) {
  const season = seasonOf(date);
  const theme = detectTheme(places);
  const time = hours.length ? timeOfDay(median(hours), date) : 'day';
  const tint = SEASON_TINTS[season];
  const colors = PALETTES[theme][time].map((color) => {
    const seasoned = blend(color, tint, 0.14);
    return dominant ? blend(seasoned, dominant, 0.1) : seasoned;
  });
  const middle = colors[1];
  return {
    name: `${TIME_NAMES[time]}の${THEME_NAMES[theme]}`,
    season,
    theme,
    time,
    colors,
    ink: luminance(middle) < 0.32 ? 'light' : 'dark',
    particle: chooseParticle(theme, time, season),
    wave: theme === 'sea',
  };
}

// 一覧画面の背景。白い文字を常に読めるよう、どの時間帯でも濃い色だけで作る。
const HOME_PALETTES = {
  morning: ['#2f4a86', '#8f4a80', '#a84f5a'],
  day: ['#174f7d', '#1b6f88', '#1f7671'],
  dusk: ['#2b2a63', '#7f3a6c', '#a84842'],
  night: ['#0d0f2b', '#231a52', '#4a2564'],
};

export function homeMood(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = timeOfDay(now.getHours() + now.getMinutes() / 60, date);
  return {
    name: TIME_NAMES[time],
    time,
    season: seasonOf(date),
    colors: HOME_PALETTES[time].map((color) => blend(color, SEASON_TINTS[seasonOf(date)], 0.06)),
    ink: 'light',
    particle: time === 'night' ? 'stars' : 'none',
    wave: false,
  };
}

export function moodGradient(mood) {
  const [a, b, c] = mood.colors;
  return `linear-gradient(172deg, ${a} 0%, ${b} 56%, ${c} 100%)`;
}

export function moodFromEntry(entry, photos = [], places = entry.places ?? []) {
  const hours = photos
    .filter((photo) => photo.taken_at)
    .map((photo) => {
      const date = new Date(photo.taken_at);
      return date.getHours() + date.getMinutes() / 60;
    });
  const cover = photos.find((photo) => photo.id === entry.cover_photo_id) ?? photos[0];
  return computeMood({ date: entry.date, hours, places, dominant: cover?.dominant ?? null });
}
