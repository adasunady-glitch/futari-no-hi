import { computeMood, homeMood, moodGradient } from '../lib/mood.js';
import { daysUntil, h, openSheet, parts, toast, todayText } from '../lib/dom.js';
import { applyMood } from './atmosphere.js';

function commentChip(entry, partnerName) {
  if (entry.iWrote && entry.partnerWrote) return h('span', { class: 'chip chip-open' }, 'ふたりのことば');
  if (entry.partnerWrote) return h('span', { class: 'chip chip-alert' }, `${partnerName}が書きました`);
  if (entry.iWrote) return h('span', { class: 'chip' }, `${partnerName}の返事待ち`);
  return h('span', { class: 'chip chip-ghost' }, 'まだ書いていません');
}

function placeLine(entry) {
  const names = [...new Set((entry.places ?? []).map((place) => place.name))];
  if (!names.length) return null;
  const shown = names.slice(0, 2).join('・');
  return names.length > 2 ? `${shown} ほか` : shown;
}

function entryCard(entry, partnerName) {
  const { month, day, weekday } = parts(entry.date);
  const mood = entry.mood ?? computeMood({ date: entry.date, places: entry.places ?? [] });
  const hasContent = entry.photoCount > 0;
  const card = h('a', {
    class: `entry-card ${hasContent ? '' : 'entry-card-pending'}`,
    href: `#/d/${entry.id}`,
    style: { background: moodGradient(mood) },
    'data-ink': entry.coverUrl ? 'light' : mood.ink,
  },
  entry.coverUrl && h('img', { class: 'entry-cover', src: entry.coverUrl, alt: '', loading: 'lazy' }),
  entry.coverUrl && h('div', { class: 'entry-scrim' }),
  h('div', { class: 'entry-text' },
    h('div', { class: 'entry-date' },
      h('span', { class: 'entry-day' }, String(day)),
      h('span', { class: 'entry-month' }, `${month}月・${weekday}曜`)),
    h('div', { class: 'entry-foot' },
      entry.title && h('p', { class: 'entry-title' }, entry.title),
      placeLine(entry) && h('p', { class: 'entry-places' }, placeLine(entry)),
      !hasContent && h('p', { class: 'entry-places' }, '写真がまだありません'),
      commentChip(entry, partnerName))));
  return card;
}

function upcomingRow(entries) {
  // 一番近い予定を大きく見せ、それ以降は件数だけにして過去の記録を主役にする。
  const next = entries[entries.length - 1];
  const { month, day, weekday } = parts(next.date);
  const days = daysUntil(next.date);
  return h('a', { class: 'next-date', href: `#/d/${next.id}` },
    h('span', { class: 'next-label' }, '次に会う日'),
    h('span', { class: 'next-value' }, `${month}月${day}日（${weekday}）`),
    h('span', { class: 'next-count' }, days === 1 ? 'あした' : `あと${days}日`),
    entries.length > 1 && h('span', { class: 'next-more' }, `ほか${entries.length - 1}件`));
}

function openNewEntry({ store }) {
  openSheet((close) => {
    const date = h('input', { type: 'date', id: 'new-date', value: todayText(), required: true });
    const title = h('input', { type: 'text', id: 'new-title', maxLength: 40, placeholder: '例：はじめての夕日（なくても大丈夫）' });
    return h('form', {
      class: 'sheet-body',
      onsubmit: async (event) => {
        event.preventDefault();
        const entry = await store.createEntry({ date: date.value, title: title.value.trim() });
        close();
        location.hash = `#/d/${entry.id}`;
      },
    },
    h('h2', {}, '会った日を記録する'),
    h('label', { for: 'new-date' }, '日付'), date,
    h('label', { for: 'new-title' }, 'ひとことタイトル'), title,
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', type: 'button', onclick: close }, 'やめる'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, '作る')));
  });
}

function passwordForm(store) {
  const input = h('input', {
    type: 'password', id: 'new-password', autocomplete: 'new-password', minLength: 8, required: true,
  });
  return h('form', {
    class: 'password-form',
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        await store.changePassword(input.value);
        input.value = '';
        toast('パスワードを変更しました');
      } catch (error) {
        console.warn(error);
        toast('変更できませんでした。別のパスワードでお試しください');
      }
    },
  },
  h('label', { for: 'new-password' }, '新しいパスワード（8文字以上）'),
  h('div', { class: 'search-row' }, input, h('button', { class: 'btn', type: 'submit' }, '変更')));
}

function openSettings({ store, session, refresh }) {
  openSheet((close) => h('div', { class: 'sheet-body' },
    h('h2', {}, '設定'),
    h('p', { class: 'muted' }, store.mode === 'demo'
      ? 'デモモードです。記録はこの端末の中だけに保存され、相手には届きません。'
      : `${session.user.name}としてログインしています。`),
    store.mode !== 'demo' && passwordForm(store),
    store.mode === 'demo' && h('button', {
      class: 'btn btn-wide',
      onclick: async () => {
        await store.reset();
        location.reload();
      },
    }, 'デモのデータを最初の状態に戻す'),
    store.mode !== 'demo' && h('button', {
      class: 'btn btn-wide',
      onclick: async () => {
        await store.signOut();
        close();
        await refresh();
      },
    }, 'ログアウト'),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: close }, '閉じる'))));
}

export async function renderTimeline(context) {
  const { store, session, refresh } = context;
  const entries = await store.listEntries();
  applyMood(homeMood());
  const today = todayText();
  const upcoming = entries.filter((entry) => entry.date > today);
  const past = entries.filter((entry) => entry.date <= today);

  const groups = new Map();
  for (const entry of past) {
    const { year } = parts(entry.date);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(entry);
  }

  return h('div', { class: 'page timeline' },
    h('header', { class: 'top-bar' },
      h('h1', { class: 'brand' }, 'ふたりの日'),
      h('div', { class: 'top-actions' },
        store.mode === 'demo' && h('button', {
          class: 'btn btn-small',
          'aria-label': `視点を${session.partner.name}に切り替える`,
          onclick: async () => {
            await store.switchViewer();
            await refresh();
          },
        }, `視点：${session.user.name}`),
        h('button', {
          class: 'icon-btn',
          'aria-label': '設定',
          onclick: () => openSettings(context),
        }, '⋯'))),
    store.mode === 'demo' && h('p', { class: 'demo-note' }, 'デモモード：サンプルの記録です。この端末にだけ保存されます。'),
    upcoming.length > 0 && upcomingRow(upcoming),
    past.length === 0
      ? h('div', { class: 'empty' },
        h('h2', {}, 'まだ記録がありません'),
        h('p', { class: 'muted' }, '会った日に、右下のボタンから写真を入れてみてください。'))
      : [...groups.entries()].map(([year, list]) => h('section', { class: 'year' },
        h('h2', { class: 'year-label' }, `${year}年`),
        h('div', { class: 'entry-list' }, list.map((entry) => entryCard(entry, session.partner.name))))),
    h('button', {
      class: 'fab',
      'aria-label': '会った日を記録する',
      onclick: () => openNewEntry(context),
    }, '＋'));
}
