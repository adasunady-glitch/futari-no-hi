import { config } from './config.js';
import { h, toast } from './lib/dom.js';
import { clearMood } from './views/atmosphere.js';
import { renderEntry } from './views/entry.js';
import { renderLogin } from './views/login.js';
import { renderTimeline } from './views/timeline.js';

const app = document.getElementById('app');

async function createStore() {
  if (config.supabaseUrl && config.supabaseAnonKey) {
    const { SupabaseStore } = await import('./store/supabase.js');
    return new SupabaseStore(config);
  }
  const { LocalStore } = await import('./store/local.js');
  return new LocalStore();
}

let store;
let renderToken = 0;

async function route() {
  const token = ++renderToken;
  const session = await store.session();
  if (token !== renderToken) return;
  clearMood();
  if (!session) {
    app.replaceChildren(renderLogin(store, route));
    return;
  }
  const match = location.hash.match(/^#\/d\/([\w-]+)/);
  const context = { store, session, refresh: route };
  const view = match
    ? await renderEntry(context, match[1])
    : await renderTimeline(context);
  if (token !== renderToken) return;
  app.replaceChildren(view);
  window.scrollTo(0, 0);
}

function showFatal(error) {
  console.error(error);
  app.replaceChildren(h('div', { class: 'empty' },
    h('h2', {}, '読み込めませんでした'),
    h('p', { class: 'muted' }, error.message ?? String(error)),
    h('button', { class: 'btn', onclick: () => location.reload() }, 'もう一度試す')));
}

async function start() {
  store = await createStore();
  await store.init();
  window.addEventListener('hashchange', () => route().catch(showFatal));
  await route();
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn(error));
  }
}

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  toast(event.reason?.message ?? 'エラーが起きました');
});

start().catch(showFatal);
