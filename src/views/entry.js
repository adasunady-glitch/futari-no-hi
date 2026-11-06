import { commentState, CATEGORY_LABELS } from '../lib/select.js';
import { moodFromEntry } from '../lib/mood.js';
import { searchPlaces } from '../lib/geo.js';
import { confirmSheet, daysUntil, h, openSheet, parts, timeText, toast } from '../lib/dom.js';
import { applyMood } from './atmosphere.js';
import { openImporter } from './importer.js';

export async function refreshMood(store, entryId) {
  const entry = await store.getEntry(entryId);
  await store.updateEntry(entryId, { mood: moodFromEntry(entry, entry.photos, entry.places) });
}

function commentSection({ store, session, refresh }, entry) {
  const { mine, partner, partnerWrote } = entry.comments;
  const state = commentState({ mine, partner, partnerWrote });
  const partnerName = session.partner.name;

  const box = h('textarea', {
    id: 'my-comment',
    rows: 4,
    placeholder: 'いちばん心に残ったことは？ 言えなかったことも、ここになら。',
    value: mine?.body ?? '',
  });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, mine ? '書き直す' : '残す');

  const partnerBlock = state === 'open'
    ? h('article', { class: 'note note-partner note-revealed' },
      h('h3', {}, partnerName),
      h('p', { class: 'note-body' }, partner.body))
    : state === 'locked'
      ? h('article', { class: 'note note-locked' },
        h('h3', {}, partnerName),
        h('div', { class: 'locked-lines', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('p', {}, '書いてくれています。あなたが書くと読めるようになります。'))
      : h('article', { class: 'note note-waiting' },
        h('h3', {}, partnerName),
        h('p', { class: 'muted' }, state === 'waiting-partner'
          ? 'まだ書いていません。書いたらここに表示されます。'
          : 'まだ書いていません。お互いが書くと、相手のことばを読めるようになります。'));

  return h('section', { class: 'panel', 'aria-labelledby': 'comments-title' },
    h('h2', { id: 'comments-title' }, 'ふたりのことば'),
    partnerBlock,
    h('form', {
      class: 'note note-mine',
      onsubmit: async (event) => {
        event.preventDefault();
        const body = box.value.trim();
        if (!body) {
          toast('ひとことだけでも書いてみてください');
          return;
        }
        save.disabled = true;
        await store.saveComment(entry.id, body);
        await refresh();
      },
    },
    h('label', { for: 'my-comment' }, session.user.name),
    box,
    h('div', { class: 'note-actions' }, save)));
}

function openLightbox({ store, refresh }, entry, photo) {
  openSheet((close) => h('div', { class: 'lightbox' },
    h('img', { src: photo.url, alt: `${CATEGORY_LABELS[photo.category] ?? '写真'}の写真` }),
    h('div', { class: 'lightbox-meta' },
      h('span', {}, [CATEGORY_LABELS[photo.category], timeText(photo.taken_at)].filter(Boolean).join('・'))),
    h('div', { class: 'sheet-actions' },
      h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          const yes = await confirmSheet({
            title: 'この写真を消しますか？',
            body: 'ふたりとも見られなくなります。元の写真は端末に残ります。',
            action: '消す',
            danger: true,
          });
          if (!yes) return;
          close();
          await store.deletePhoto(photo);
          await refreshMood(store, entry.id);
          await refresh();
        },
      }, '消す'),
      entry.cover_photo_id !== photo.id && h('button', {
        class: 'btn',
        onclick: async () => {
          await store.updateEntry(entry.id, { cover_photo_id: photo.id });
          close();
          await refreshMood(store, entry.id);
          await refresh();
        },
      }, '表紙にする'),
      h('button', { class: 'btn', onclick: close }, '閉じる'))));
}

function photoSection(context, entry) {
  const add = h('button', {
    class: entry.photos.length ? 'btn btn-small' : 'btn btn-primary btn-wide',
    onclick: () => openImporter(context, entry),
  }, entry.photos.length ? '写真を追加' : 'この日の写真を選ぶ');

  return h('section', { class: 'panel', 'aria-labelledby': 'photos-title' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'photos-title' }, 'この日の写真'),
      entry.photos.length > 0 && add),
    entry.photos.length === 0
      ? h('div', { class: 'panel-empty' },
        h('p', { class: 'muted' }, 'この日の写真をまとめて選ぶと、ごはん・風景・ツーショットなどから良いものを残します。'),
        add)
      : h('div', { class: 'gallery' }, entry.photos.map((photo, index) => h('button', {
        class: `gallery-item ${index % 5 === 0 ? 'gallery-wide' : ''}`,
        'aria-label': `${CATEGORY_LABELS[photo.category] ?? '写真'}の写真を開く`,
        onclick: () => openLightbox(context, entry, photo),
      },
      h('img', { src: index % 5 === 0 ? photo.url : photo.thumbUrl, alt: '', loading: 'lazy' }),
      h('span', { class: 'gallery-tag' }, CATEGORY_LABELS[photo.category] ?? '')))));
}

async function drawMap(container, places) {
  const located = places.filter((place) => place.lat != null && place.lng != null);
  if (!located.length) return;
  const css = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  if (!document.querySelector(`link[href="${css}"]`)) {
    document.head.append(h('link', { rel: 'stylesheet', href: css }));
  }
  const L = await import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
  const map = L.map(container, { scrollWheelZoom: false, attributionControl: true, dragging: !L.Browser.mobile, tap: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  const points = located.map((place) => [place.lat, place.lng]);
  if (points.length > 1) L.polyline(points, { color: '#c0566f', weight: 3, opacity: 0.8, dashArray: '2 8' }).addTo(map);
  located.forEach((place, index) => {
    L.marker([place.lat, place.lng], {
      title: place.name,
      icon: L.divIcon({ className: 'map-pin', html: `<span>${index + 1}</span>`, iconSize: [28, 28] }),
    }).addTo(map);
  });
  map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15 });
}

function openAddPlace({ store, refresh }, entry) {
  openSheet((close) => {
    const input = h('input', { type: 'search', id: 'place-query', placeholder: '例：江の島水族館', required: true });
    const results = h('div', { class: 'place-results' });
    const addPlace = async (place) => {
      await store.addPlaces(entry.id, [{
        name: place.name, kind: place.kind ?? null, lat: place.lat ?? null, lng: place.lng ?? null, arrived_at: null,
      }]);
      close();
      await refreshMood(store, entry.id);
      await refresh();
    };
    const form = h('form', {
      class: 'place-search',
      onsubmit: async (event) => {
        event.preventDefault();
        results.replaceChildren(h('p', { class: 'muted' }, '探しています…'));
        try {
          const found = await searchPlaces(input.value.trim());
          results.replaceChildren(
            ...found.map((place) => h('button', {
              class: 'place-result',
              type: 'button',
              onclick: () => addPlace(place),
            }, h('strong', {}, place.name), h('small', {}, place.detail))),
            h('button', {
              class: 'place-result',
              type: 'button',
              onclick: () => addPlace({ name: input.value.trim() }),
            }, h('strong', {}, `「${input.value.trim()}」をそのまま追加`), h('small', {}, '地図には表示されません')),
          );
        } catch (error) {
          console.warn(error);
          results.replaceChildren(
            h('p', { class: 'muted' }, '地名を検索できませんでした。'),
            h('button', {
              class: 'place-result',
              type: 'button',
              onclick: () => addPlace({ name: input.value.trim() }),
            }, h('strong', {}, `「${input.value.trim()}」をそのまま追加`)),
          );
        }
      },
    },
    h('label', { for: 'place-query' }, '場所の名前'),
    h('div', { class: 'search-row' }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, '探す')));
    return h('div', { class: 'sheet-body' },
      h('h2', {}, '行った場所を追加'),
      form,
      results,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: close }, 'やめる')));
  });
}

function placeSection(context, entry) {
  const { store, refresh } = context;
  const mapBox = h('div', { class: 'map' });
  const hasPoints = entry.places.some((place) => place.lat != null);
  if (hasPoints) {
    queueMicrotask(() => drawMap(mapBox, entry.places).catch((error) => {
      console.warn(error);
      mapBox.replaceChildren(h('p', { class: 'muted map-error' }, '地図を読み込めませんでした'));
    }));
  }
  return h('section', { class: 'panel', 'aria-labelledby': 'places-title' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'places-title' }, '行った場所'),
      h('button', { class: 'btn btn-small', onclick: () => openAddPlace(context, entry) }, '追加')),
    hasPoints && mapBox,
    entry.places.length === 0
      ? h('p', { class: 'muted' }, '位置情報つきの写真を入れると、ここに自動で並びます。')
      : h('ol', { class: 'place-list' }, entry.places.map((place) => h('li', {},
        h('span', { class: 'place-time' }, timeText(place.arrived_at)),
        h('span', { class: 'place-name' }, place.name),
        h('button', {
          class: 'icon-btn icon-btn-small',
          'aria-label': `${place.name}を一覧から外す`,
          onclick: async () => {
            await store.deletePlace(place.id);
            await refreshMood(store, entry.id);
            await refresh();
          },
        }, '×')))));
}

function hero({ store }, entry, mood) {
  const { year, month, day, weekday } = parts(entry.date);
  const away = daysUntil(entry.date);
  const title = h('input', {
    class: 'hero-title',
    type: 'text',
    value: entry.title,
    maxLength: 40,
    placeholder: 'タイトルをつける',
    'aria-label': 'この日のタイトル',
    onchange: async (event) => {
      await store.updateEntry(entry.id, { title: event.target.value.trim() });
      toast('タイトルを残しました');
    },
  });
  return h('header', { class: 'hero' },
    h('a', { class: 'back-link', href: '#/' }, '← 一覧へ'),
    h('p', { class: 'hero-year' }, `${year}年`),
    h('h1', { class: 'hero-date' },
      h('span', { class: 'hero-month' }, `${month}月`),
      h('span', { class: 'hero-day' }, String(day)),
      h('span', { class: 'hero-weekday' }, `${weekday}曜日`)),
    title,
    h('p', { class: 'hero-mood' }, away > 0 ? `あと${away}日` : mood.name));
}

export async function renderEntry(context, id) {
  const { store } = context;
  const entry = await store.getEntry(id);
  if (!entry) {
    return h('div', { class: 'empty' },
      h('h2', {}, 'この記録は見つかりません'),
      h('a', { class: 'btn', href: '#/' }, '一覧へ戻る'));
  }
  const mood = moodFromEntry(entry, entry.photos, entry.places);
  applyMood(mood);
  return h('div', { class: 'page detail' },
    hero(context, entry, mood),
    commentSection(context, entry),
    photoSection(context, entry),
    placeSection(context, entry),
    h('div', { class: 'detail-foot' },
      h('button', {
        class: 'text-danger',
        onclick: async () => {
          const yes = await confirmSheet({
            title: 'この日の記録を消しますか？',
            body: '写真とふたりのコメントも消え、元に戻せません。',
            action: '記録を消す',
            danger: true,
          });
          if (!yes) return;
          await store.deleteEntry(entry.id);
          location.hash = '#/';
        },
      }, 'この日の記録を消す')));
}
