// 写真を取り込む流れ：まとめて選ぶ → 端末内で解析 → 自分で確認 → 保存して共有。
import { analyzeFiles, preparePhotoForSave } from '../lib/photos.js';
import { CATEGORY_LABELS, clusterPlaces, haversineMeters, MAX_SELECTED } from '../lib/select.js';
import { reverseGeocode } from '../lib/geo.js';
import { h, openSheet, parts, timeText, toast } from '../lib/dom.js';
import { moodFromEntry } from '../lib/mood.js';

const MAX_PLACES = 8;

async function resolvePlaces(photos, existing, onProgress) {
  const clusters = clusterPlaces(photos.map((photo) => ({
    lat: photo.lat, lng: photo.lng, takenAt: photo.takenAt,
  })))
    .filter((cluster) => !existing.some((place) => (
      place.lat != null && haversineMeters(place, cluster) <= 300
    )))
    .slice(0, MAX_PLACES);
  const places = [];
  for (const [index, cluster] of clusters.entries()) {
    onProgress(index + 1, clusters.length);
    let named = { name: `場所${index + 1}`, kind: null, unresolved: true };
    try {
      named = await reverseGeocode(cluster.lat, cluster.lng);
    } catch (error) {
      console.warn(error);
    }
    places.push({
      ...named,
      lat: cluster.lat,
      lng: cluster.lng,
      arrived_at: cluster.arrivedAt ? new Date(cluster.arrivedAt).toISOString() : null,
      keep: true,
    });
  }
  return places;
}

function pickStep(entry, onFiles) {
  const { month, day } = parts(entry.date);
  const handle = (event) => {
    const files = [...event.target.files];
    if (files.length) onFiles(files);
  };
  const photoInput = h('input', {
    id: 'photo-input', class: 'visually-hidden', type: 'file', accept: 'image/*', multiple: true, onchange: handle,
  });
  const fileInput = h('input', {
    id: 'file-input', class: 'visually-hidden', type: 'file', multiple: true, onchange: handle,
  });
  return h('div', { class: 'import-pick' },
    h('p', {}, `${month}月${day}日の写真をまとめて選んでください。多めに選んで大丈夫です。別の日の写真は自動で外します。`),
    h('label', { class: 'btn btn-primary btn-wide', for: 'photo-input' }, '写真を選ぶ'),
    photoInput,
    h('div', { class: 'hint' },
      h('h3', {}, '場所も読み込むには'),
      h('p', {}, h('strong', {}, 'iPhone: '), '写真を選ぶ画面の「オプション」で、位置情報をオンにしてください。'),
      h('p', {}, h('strong', {}, 'Android: '), '位置情報が読めないときは、次のボタンからファイルとして選んでください。'),
      h('label', { class: 'btn btn-small', for: 'file-input' }, 'ファイルから選ぶ'),
      fileInput));
}

function progressStep(note) {
  const label = h('p', { class: 'progress-label' }, '準備しています…');
  const bar = h('progress', { max: 1, value: 0, 'aria-label': '進み具合' });
  const element = h('div', { class: 'import-progress' },
    label, bar, note && h('p', { class: 'muted' }, note));
  return {
    element,
    update(text, done, total) {
      label.textContent = text;
      bar.max = total || 1;
      bar.value = done;
    },
  };
}

function reviewStep(result, places, { onSave }) {
  const { photos, selected } = result;
  const saveButton = h('button', { class: 'btn btn-primary', onclick: () => onSave(selected, places) });
  const updateCount = () => {
    saveButton.textContent = `${selected.size}枚を保存して共有`;
    saveButton.disabled = selected.size === 0;
  };
  updateCount();

  const tile = (photo) => {
    const button = h('button', {
      class: `pick-tile ${selected.has(photo.id) ? 'picked' : ''}`,
      'aria-pressed': String(selected.has(photo.id)),
      'aria-label': `${CATEGORY_LABELS[photo.category]}の写真 ${timeText(photo.takenAt)}`,
      onclick: () => {
        const nowPicked = !selected.has(photo.id);
        if (nowPicked) selected.add(photo.id);
        else selected.delete(photo.id);
        button.classList.toggle('picked', nowPicked);
        button.setAttribute('aria-pressed', String(nowPicked));
        updateCount();
      },
    },
    h('img', { src: photo.previewUrl, alt: '' }),
    h('span', { class: 'pick-tag' }, photo.rejectReason ?? (photo.duplicateOf ? '似た写真' : CATEGORY_LABELS[photo.category])),
    h('span', { class: 'pick-mark', 'aria-hidden': 'true' }, '✓'));
    return button;
  };

  const chosen = photos.filter((photo) => selected.has(photo.id));
  const others = photos.filter((photo) => !selected.has(photo.id));

  const notes = [];
  if (result.outOfDay) notes.push(`別の日の写真${result.outOfDay}枚を外しました。`);
  if (result.failed.length) notes.push(`${result.failed.length}枚はこの端末で読み込めませんでした。`);
  if (!result.visionUsed) notes.push('画像認識を読み込めなかったので、明るさとピントで選びました。');
  if (result.withLocation === 0 && photos.length) notes.push('位置情報のある写真がなかったので、場所は後から追加してください。');

  const placeList = places.length > 0 && h('section', { class: 'review-places' },
    h('h3', {}, '行った場所'),
    places.map((place) => {
      const name = h('input', {
        type: 'text',
        value: place.name,
        'aria-label': '場所の名前',
        oninput: (event) => { place.name = event.target.value; },
      });
      const keep = h('input', {
        type: 'checkbox',
        checked: true,
        'aria-label': `${place.name}を残す`,
        onchange: (event) => { place.keep = event.target.checked; },
      });
      return h('div', { class: 'review-place' },
        keep,
        h('span', { class: 'place-time' }, timeText(place.arrived_at)),
        name);
    }));

  return h('div', { class: 'import-review' },
    h('p', { class: 'review-summary' },
      photos.length === selected.size
        ? `${photos.length}枚すべてを候補にしました。`
        : `${photos.length}枚から${selected.size}枚を選びました（最大${MAX_SELECTED}枚）。`),
    h('p', { class: 'muted' }, 'タップで入れ替えられます。保存するまで相手には見えません。'),
    notes.map((note) => h('p', { class: 'review-note' }, note)),
    chosen.length > 0 && h('div', { class: 'pick-grid' }, chosen.map(tile)),
    others.length > 0 && h('details', { class: 'review-others' },
      h('summary', {}, `選ばなかった写真（${others.length}枚）`),
      h('div', { class: 'pick-grid' }, others.map(tile))),
    placeList,
    h('div', { class: 'sheet-sticky' }, saveButton));
}

async function chooseCover(store, entryId) {
  const entry = await store.getEntry(entryId);
  const updates = {};
  if (!entry.cover_photo_id && entry.photos.length) {
    const best = [...entry.photos].sort((a, b) => b.score - a.score)[0];
    updates.cover_photo_id = best.id;
    entry.cover_photo_id = best.id;
  }
  updates.mood = moodFromEntry(entry, entry.photos, entry.places);
  await store.updateEntry(entryId, updates);
}

export function openImporter({ store, refresh }, entry) {
  let saving = false;
  openSheet((close) => {
    const body = h('div', { class: 'sheet-body sheet-tall' });
    const title = h('h2', {}, 'この日の写真を選ぶ');
    const closeButton = h('button', {
      class: 'icon-btn sheet-close',
      'aria-label': '閉じる',
      onclick: () => {
        if (!saving) close();
      },
    }, '×');
    const content = h('div', {});
    body.append(h('div', { class: 'sheet-title-row' }, title, closeButton), content);

    const save = async (selected, places, result) => {
      saving = true;
      const chosen = result.photos.filter((photo) => selected.has(photo.id));
      const progress = progressStep();
      content.replaceChildren(progress.element);
      try {
        const items = [];
        for (const [index, photo] of chosen.entries()) {
          progress.update(`保存の準備 ${index + 1} / ${chosen.length}`, index, chosen.length);
          items.push(await preparePhotoForSave(photo));
        }
        await store.addPhotos(entry.id, items, (done, total) => {
          progress.update(`保存しています ${done} / ${total}`, done, total);
        });
        await store.addPlaces(entry.id, places
          .filter((place) => place.keep && place.name.trim())
          .map(({ name, kind, lat, lng, arrived_at }) => ({
            name: name.trim(), kind, lat, lng, arrived_at,
          })));
        await chooseCover(store, entry.id);
        saving = false;
        close();
        toast(`${chosen.length}枚を残しました`);
        await refresh();
      } catch (error) {
        saving = false;
        console.error(error);
        toast('保存できませんでした。通信を確かめてもう一度お試しください');
        content.replaceChildren(reviewStep(result, places, {
          onSave: (again, againPlaces) => save(again, againPlaces, result),
        }));
      }
    };

    const analyze = async (files) => {
      const progress = progressStep('写真の解析はこの端末の中だけで行います。');
      content.replaceChildren(progress.element);
      progress.update('画像認識を準備しています…', 0, files.length);
      const result = await analyzeFiles(files, entry, (done, total) => {
        progress.update(`写真を見ています ${done} / ${total}`, done, total);
      });
      if (!result.photos.length) {
        toast(result.outOfDay ? 'この日に撮った写真が見つかりませんでした' : '写真を読み込めませんでした');
        content.replaceChildren(pickStep(entry, analyze));
        return;
      }
      const places = await resolvePlaces(result.photos, entry.places, (done, total) => {
        progress.update(`場所を調べています ${done} / ${total}`, done, total);
      });
      title.textContent = '残す写真を確かめる';
      content.replaceChildren(reviewStep(result, places, {
        onSave: (selected, chosenPlaces) => save(selected, chosenPlaces, result),
      }));
    };

    content.append(pickStep(entry, analyze));
    return body;
  }, { dismissible: false });
}
