// デモ用のサンプル。写真の代わりに、キャンバスで描いた架空の絵を使う。
import { moodFromEntry } from '../lib/mood.js';

function canvasToBlob(canvas, quality = 0.82) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function sky(ctx, w, h, stops) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

const SCENES = {
  sunsetSea(ctx, w, h) {
    sky(ctx, w, h * 0.62, ['#2d3468', '#b5546f', '#f6a95f']);
    ctx.fillStyle = '#ffe2a8';
    ctx.beginPath();
    ctx.arc(w * 0.62, h * 0.58, h * 0.09, 0, Math.PI * 2);
    ctx.fill();
    const sea = ctx.createLinearGradient(0, h * 0.62, 0, h);
    sea.addColorStop(0, '#d0776f');
    sea.addColorStop(1, '#1d2b52');
    ctx.fillStyle = sea;
    ctx.fillRect(0, h * 0.62, w, h);
  },
  couple(ctx, w, h) {
    SCENES.sunsetSea(ctx, w, h);
    ctx.fillStyle = '#17172d';
    for (const [x, r] of [[0.42, 0.075], [0.58, 0.068]]) {
      ctx.beginPath();
      ctx.arc(w * x, h * 0.58, h * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * x, h * 0.92, h * (r + 0.07), h * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  food(ctx, w, h) {
    sky(ctx, w, h, ['#6d4a36', '#8b5e41']);
    ctx.fillStyle = '#f6f1e6';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.33, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d98a3b';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.2, h * 0.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6f9a4f';
    ctx.beginPath();
    ctx.ellipse(w * 0.46, h * 0.44, w * 0.06, h * 0.05, -0.4, 0, Math.PI * 2);
    ctx.fill();
  },
  park(ctx, w, h) {
    sky(ctx, w, h * 0.65, ['#a8d7f0', '#e3f2f4']);
    ctx.fillStyle = '#8cc48a';
    ctx.fillRect(0, h * 0.65, w, h);
    ctx.fillStyle = '#f4b9cb';
    for (const [x, y, r] of [[0.2, 0.4, 0.2], [0.42, 0.34, 0.17], [0.78, 0.42, 0.22]]) {
      ctx.beginPath();
      ctx.arc(w * x, h * y, h * r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  cityNight(ctx, w, h) {
    sky(ctx, w, h, ['#0e0c26', '#2b1c52', '#5c2a64']);
    for (let i = 0; i < 9; i += 1) {
      const x = (i / 9) * w;
      const height = h * (0.3 + ((i * 37) % 40) / 100);
      ctx.fillStyle = '#15132e';
      ctx.fillRect(x, h - height, w / 9 - 3, height);
      ctx.fillStyle = '#f8cf76';
      for (let j = 0; j < 8; j += 1) {
        if ((i * 7 + j * 3) % 3 === 0) ctx.fillRect(x + 7, h - height + 10 + j * 26, 7, 11);
      }
    }
  },
};

async function makePhoto(scene, category, takenAt, dominant) {
  const full = document.createElement('canvas');
  full.width = 1200;
  full.height = 900;
  SCENES[scene](full.getContext('2d'), full.width, full.height);
  const thumb = document.createElement('canvas');
  thumb.width = 480;
  thumb.height = 360;
  thumb.getContext('2d').drawImage(full, 0, 0, 480, 360);
  return {
    full: await canvasToBlob(full),
    thumb: await canvasToBlob(thumb),
    category,
    score: 0.8,
    taken_at: new Date(takenAt).toISOString(),
    dominant,
    width: 1200,
    height: 900,
  };
}

function shiftDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function seedDemo(store) {
  const seaDate = shiftDays(-12);
  const cityDate = shiftDays(-40);
  const parkDate = shiftDays(-210);

  const samples = [
    {
      date: seaDate,
      title: 'はじめての夕日',
      photos: [
        ['food', 'food', `${seaDate}T13:10:00`, '#8b5e41'],
        ['sunsetSea', 'scenery', `${seaDate}T17:05:00`, '#b5546f'],
        ['couple', 'two', `${seaDate}T17:20:00`, '#b5546f'],
      ],
      places: [
        { name: '湘南の定食屋', kind: 'restaurant', lat: 35.3107, lng: 139.4833, arrived_at: `${seaDate}T13:00:00` },
        { name: '七里ヶ浜', kind: 'beach', lat: 35.3058, lng: 139.5136, arrived_at: `${seaDate}T16:40:00` },
      ],
      me: '夕日を待っている時間がいちばん好きだった。また行きたい。',
      partner: '実は寒かったけど、言わないで正解だったと思ってる。ごはんも海も最高だった！',
    },
    {
      date: cityDate,
      title: '',
      photos: [['cityNight', 'scenery', `${cityDate}T20:15:00`, '#2b1c52']],
      places: [{ name: '渋谷', kind: 'city', lat: 35.6595, lng: 139.7005, arrived_at: `${cityDate}T19:00:00` }],
      partner: '映画のあとに話した時間が楽しかった。感想が同じでうれしかった。',
    },
    {
      date: parkDate,
      title: 'お花見',
      photos: [['park', 'scenery', `${parkDate}T13:30:00`, '#8cc48a']],
      places: [{ name: '新宿御苑', kind: 'park', lat: 35.6852, lng: 139.71, arrived_at: `${parkDate}T12:30:00` }],
    },
  ];

  for (const sample of samples) {
    const entry = await store.createEntry({ date: sample.date, title: sample.title });
    const items = await Promise.all(sample.photos.map((args) => makePhoto(...args)));
    await store.addPhotos(entry.id, items);
    const places = sample.places.map((place) => ({
      ...place,
      arrived_at: new Date(place.arrived_at).toISOString(),
    }));
    await store.addPlaces(entry.id, places);
    if (sample.me) await store.seedAs('me', () => store.saveComment(entry.id, sample.me));
    if (sample.partner) await store.seedAs('partner', () => store.saveComment(entry.id, sample.partner));
    const saved = await store.getEntry(entry.id);
    await store.updateEntry(entry.id, { mood: moodFromEntry(saved, saved.photos, saved.places) });
  }

  await store.createEntry({ date: shiftDays(9), source: 'calendar' });
}
