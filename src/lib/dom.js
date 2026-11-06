// 小さな描画用の道具。

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in element && key !== 'list') element[key] = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return element;
}

let toastTimer = null;
export function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 3200);
}

// 画面下から出るシート。閉じると要素ごと片付ける。
// dismissible を false にすると、閉じるボタン以外では閉じない（作業の途中で消えないように）。
export function openSheet(render, { onClose, dismissible = true } = {}) {
  const dialog = h('dialog', { class: 'sheet' });
  const close = () => dialog.close();
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  dialog.addEventListener('click', (event) => {
    if (dismissible && event.target === dialog) close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (!dismissible) event.preventDefault();
  });
  dialog.append(render(close));
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

export function confirmSheet({ title, body, action, danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet((close) => h('div', { class: 'sheet-body' },
      h('h2', {}, title),
      body && h('p', { class: 'muted' }, body),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: close }, 'やめる'),
        h('button', {
          class: danger ? 'btn btn-danger' : 'btn btn-primary',
          onclick: () => { answer = true; close(); },
        }, action))), { onClose: () => resolve(answer) });
  });
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function parts(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: WEEKDAYS[date.getDay()],
  };
}

export function todayText() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function daysUntil(dateText) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${dateText}T00:00:00`) - new Date(`${todayText()}T00:00:00`)) / dayMs);
}

export function timeText(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}
