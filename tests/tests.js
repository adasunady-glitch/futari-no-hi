// ブラウザで tests/index.html を開くと実行される。追加のインストールは不要。
import { clusterPlaces, commentState, hammingDistance, isWithinDay, markDuplicates, selectBest } from '../src/lib/select.js';
import { computeMood, homeMood, luminance, seasonOf, timeOfDay } from '../src/lib/mood.js';
import { categoryFromLabels, countMainFaces } from '../src/lib/vision.js';

const results = document.getElementById('results');
let passed = 0;
let failed = 0;

function section(title) {
  results.append(Object.assign(document.createElement('h2'), { textContent: title }));
}

async function test(name, body) {
  const line = document.createElement('div');
  try {
    await body();
    passed += 1;
    line.className = 'pass';
    line.textContent = `ok   ${name}`;
  } catch (error) {
    failed += 1;
    line.className = 'fail';
    line.textContent = `FAIL ${name}\n     ${error.message}`;
  }
  results.append(line);
}

function equal(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} 期待 ${b} / 実際 ${a}`);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

const hash = (seed) => Array.from({ length: 64 }, (_, i) => (((seed * 2654435761 + i * i * 40503) >>> 7) % 2 ? '1' : '0')).join('');

function photo(id, category, score, extra = {}) {
  return { id, category, score, hash: hash(id.length * 31 + id.charCodeAt(0) * 17 + id.charCodeAt(id.length - 1) * 101), takenAt: null, ...extra };
}

section('写真の選定');

await test('連写は最高点の1枚だけが残る', () => {
  const shared = hash(7);
  const photos = [
    photo('a', 'two', 0.5, { hash: shared, takenAt: 1000 }),
    photo('b', 'two', 0.9, { hash: shared, takenAt: 2000 }),
    photo('c', 'two', 0.7, { hash: shared, takenAt: 3000 }),
  ];
  markDuplicates(photos);
  equal(photos.filter((p) => !p.duplicateOf).map((p) => p.id), ['b']);
});

await test('似た構図でも時間が離れていれば別の写真として残す', () => {
  const shared = hash(7);
  const photos = [
    photo('a', 'scenery', 0.5, { hash: shared, takenAt: 0 }),
    photo('b', 'scenery', 0.9, { hash: shared, takenAt: 60 * 60 * 1000 }),
  ];
  markDuplicates(photos);
  equal(photos.filter((p) => !p.duplicateOf).length, 2);
});

await test('ハミング距離を数える', () => equal(hammingDistance('1010', '0011'), 2));

await test('点が低くてもカテゴリの偏りを避けて選ぶ', () => {
  const photos = [
    ...Array.from({ length: 20 }, (_, i) => photo(`food${i}x`, 'food', 0.9)),
    photo('two1', 'two', 0.4),
    photo('sea1', 'scenery', 0.3),
  ];
  const ids = selectBest(photos, 5).map((p) => p.id);
  truthy(ids.includes('two1'), `ツーショットが選ばれていない: ${ids}`);
  truthy(ids.includes('sea1'), `風景が選ばれていない: ${ids}`);
});

await test('上限を超えて選ばない', () => {
  const photos = Array.from({ length: 40 }, (_, i) => photo(`p${i}y`, 'other', i / 40));
  equal(selectBest(photos, 12).length, 12);
});

await test('枠が余れば同じカテゴリから埋める', () => {
  const photos = Array.from({ length: 8 }, (_, i) => photo(`p${i}z`, 'food', 0.5));
  equal(selectBest(photos, 12).length, 8);
});

await test('スクリーンショットと重複は選ばない', () => {
  const photos = [
    photo('s', 'other', 1, { rejectReason: 'スクリーンショット' }),
    photo('d', 'other', 1, { duplicateOf: 'k' }),
    photo('k', 'other', 0.2),
  ];
  equal(selectBest(photos).map((p) => p.id), ['k']);
});

await test('顔が2つならツーショット候補として数える', () => {
  const box = (w, h) => ({ boundingBox: { width: w, height: h } });
  equal(countMainFaces([box(100, 100), box(90, 90)], 640 * 480), 2);
});

await test('背景の小さな顔は人数に入れない', () => {
  const box = (w, h) => ({ boundingBox: { width: w, height: h } });
  equal(countMainFaces([box(120, 120), box(110, 110), box(14, 14)], 640 * 480), 2);
});

await test('画像分類のラベルからカテゴリを決める', () => {
  equal(categoryFromLabels([{ name: 'pizza', score: 0.6 }]), 'food');
  equal(categoryFromLabels([{ name: 'seashore', score: 0.4 }, { name: 'plate', score: 0.05 }]), 'scenery');
  equal(categoryFromLabels([{ name: 'keyboard', score: 0.9 }]), null);
});

section('日付と場所');

await test('夜遅くの写真は同じ日に含める', () => {
  const at = (text) => new Date(text).getTime();
  truthy(isWithinDay(at('2026-11-07T01:30:00'), '2026-11-06'), '翌1時半は含む');
  truthy(!isWithinDay(at('2026-11-07T05:00:00'), '2026-11-06'), '翌5時は含まない');
  truthy(!isWithinDay(at('2026-11-05T23:00:00'), '2026-11-06'), '前日は含まない');
  truthy(isWithinDay(null, '2026-11-06'), '撮影日が不明なら候補に残す');
});

await test('泊まりのデートは終了日まで含める', () => {
  const at = new Date('2026-11-08T12:00:00').getTime();
  truthy(isWithinDay(at, '2026-11-07', '2026-11-08'), '2日目を含む');
  truthy(!isWithinDay(at, '2026-11-07'), '終了日がなければ含まない');
});

await test('近い写真を1か所にまとめる', () => {
  const clusters = clusterPlaces([
    { lat: 35.3058, lng: 139.5136, takenAt: 1 },
    { lat: 35.3060, lng: 139.5138, takenAt: 2 },
    { lat: 35.6595, lng: 139.7005, takenAt: 3 },
  ]);
  equal(clusters.length, 2);
  equal(clusters[0].count, 2);
});

await test('位置情報のない写真は場所にしない', () => {
  equal(clusterPlaces([{ lat: null, lng: null, takenAt: 1 }]).length, 0);
});

await test('撮影順に並べ、戻ってきた場所は別の訪問にする', () => {
  const clusters = clusterPlaces([
    { lat: 35.0, lng: 139.0, takenAt: 3 },
    { lat: 35.0, lng: 139.0, takenAt: 1 },
    { lat: 36.0, lng: 140.0, takenAt: 2 },
  ]);
  equal(clusters.map((c) => c.arrivedAt), [1, 2, 3]);
});

section('コメントの見え方');

await test('状態を判定する', () => {
  equal(commentState({ mine: null, partner: null, partnerWrote: false }), 'empty');
  equal(commentState({ mine: null, partner: null, partnerWrote: true }), 'locked');
  equal(commentState({ mine: { body: 'x' }, partner: null, partnerWrote: false }), 'waiting-partner');
  equal(commentState({ mine: { body: 'x' }, partner: { body: 'y' }, partnerWrote: true }), 'open');
});

section('背景');

await test('季節を判定する', () => {
  equal(['2026-04-01', '2026-07-01', '2026-10-01', '2026-01-01'].map(seasonOf), ['spring', 'summer', 'autumn', 'winter']);
});

await test('日の入りの違いを時間帯に反映する', () => {
  equal(timeOfDay(18, '2026-12-01'), 'night');
  equal(timeOfDay(18, '2026-07-01'), 'dusk');
});

await test('夕方の海は夕暮れの海になる', () => {
  const mood = computeMood({ date: '2026-08-10', hours: [17.5, 18, 18.5], places: [{ name: '七里ヶ浜', kind: 'natural beach' }] });
  equal(mood.name, '夕暮れの海');
  equal(mood.wave, true);
});

await test('夜の街、春の公園、水族館を見分ける', () => {
  equal(computeMood({ date: '2026-10-10', hours: [21], places: [{ name: '渋谷', kind: 'place city' }] }).name, '夜の街');
  equal(computeMood({ date: '2026-04-05', hours: [13], places: [{ name: '新宿御苑', kind: 'leisure park' }] }).particle, 'petals');
  equal(computeMood({ date: '2026-08-02', hours: [15], places: [{ name: '新江ノ島水族館', kind: 'tourism aquarium' }] }).name, '昼下がりの水族館');
});

await test('街の名前を海や山と誤認しない', () => {
  for (const name of ['代官山', '青山', '港区', '横浜', '吉祥寺', '広島']) {
    equal(computeMood({ date: '2026-10-10', hours: [21], places: [{ name }] }).theme, 'city', name);
  }
});

await test('地図データの種類から場所を見分ける', () => {
  const themeOf = (kind) => computeMood({ date: '2026-10-10', places: [{ name: '名前', kind }] }).theme;
  equal(themeOf('natural beach'), 'sea');
  equal(themeOf('natural peak'), 'mountain');
  equal(themeOf('amenity place_of_worship'), 'shrine');
  equal(themeOf('leisure park'), 'park');
});

await test('写真も場所もない日でも背景を作れる', () => {
  truthy(computeMood({ date: '2026-11-15' }).colors.length === 3, '色が3つ');
});

await test('文字色は背景の明るさに合わせる', () => {
  for (const month of ['01', '04', '07', '10']) {
    for (const hours of [[8], [13], [18.5], [22]]) {
      for (const name of ['渋谷', '七里ヶ浜', '箱根山', '新宿御苑', '明治神宮', '水族館']) {
        const mood = computeMood({ date: `2026-${month}-15`, hours, places: [{ name }] });
        const lum = luminance(mood.colors[1]);
        truthy((mood.ink === 'light') === (lum < 0.32), `${mood.name}: ${lum}`);
      }
    }
  }
});

await test('一覧画面の背景はどの時間帯と季節でも白い文字が読める', () => {
  for (let month = 0; month < 12; month += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const mood = homeMood(new Date(2026, month, 15, hour));
      for (const color of mood.colors) {
        const contrast = 1.05 / (luminance(color) + 0.05);
        truthy(contrast >= 4.5, `${month + 1}月${hour}時 ${color}: ${contrast.toFixed(2)}`);
      }
    }
  }
});

await test('一覧画面の背景は時間帯で変わる', () => {
  equal(homeMood(new Date(2026, 6, 15, 8)).time, 'morning');
  equal(homeMood(new Date(2026, 6, 15, 13)).time, 'day');
  equal(homeMood(new Date(2026, 6, 15, 18)).time, 'dusk');
  equal(homeMood(new Date(2026, 6, 15, 22)).time, 'night');
  equal(homeMood(new Date(2026, 6, 15, 22)).particle, 'stars');
});

section('カレンダーの判定（Apps Script）');

const scriptSource = await (await fetch('../apps-script/sync.gs')).text();
const isMeetEvent = new Function(`${scriptSource}\nreturn isMeetEvent;`)();

await test('黄色の「会う」を読み込む', () => {
  truthy(isMeetEvent('会う', '5'), '黄色の会う');
  truthy(isMeetEvent(' 彼女と会う ', '5'), '黄色で会うを含む');
});

await test('無関係な予定は読み込まない', () => {
  truthy(!isMeetEvent('会う', '11'), '赤の会う');
  truthy(!isMeetEvent('バイト', '5'), '黄色のバイト');
  truthy(!isMeetEvent('友達に会う', ''), '色なしの友達に会う');
});

await test('色を個別に付けていない「会う」は読み込む', () => {
  truthy(isMeetEvent('会う', ''), 'カレンダー自体が黄色の場合');
});

await runDatabaseTests();

document.getElementById('summary').textContent = failed
  ? `${failed} 件失敗 / ${passed} 件成功`
  : `すべて成功 (${passed} 件)`;
document.title = failed ? 'FAILED' : 'PASSED';

async function runDatabaseTests() {
  section('データベースの権限（PostgreSQL 実物）');
  const { PGlite } = await import('https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js');
  const db = new PGlite();
  const ME = '00000000-0000-0000-0000-00000000000a';
  const PARTNER = '00000000-0000-0000-0000-00000000000b';
  const STRANGER = '00000000-0000-0000-0000-00000000000c';

  // Supabase が用意している部分だけを最小限に再現する。
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    insert into auth.users values ('${ME}', 'me@example.com'), ('${PARTNER}', 'p@example.com'), ('${STRANGER}', 's@example.com');
  `);
  await db.exec(await (await fetch('../supabase/schema.sql')).text());
  await db.exec(`
    insert into public.members values ('${ME}', '自分'), ('${PARTNER}', '相手');
  `);

  async function as(userId, action) {
    await db.exec(userId
      ? `set role authenticated; select set_config('request.jwt.sub', '${userId}', false);`
      : `set role anon; select set_config('request.jwt.sub', '', false);`);
    try {
      return await action();
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.sub', '', false);`);
    }
  }
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  async function fails(action, label) {
    let threw = false;
    try {
      await action();
    } catch {
      threw = true;
    }
    truthy(threw, label);
  }

  const secret = (await rows('select private.rotate_sync_secret() as s'))[0].s;
  let entryId;

  await test('メンバーは記録を作れる', async () => {
    const created = await as(ME, () => rows(`insert into public.entries (date, title) values ('2026-10-01', 'test') returning id`));
    entryId = created[0].id;
    truthy(entryId, 'id がある');
  });

  await test('相手も同じ記録を読める', async () => {
    equal((await as(PARTNER, () => rows('select title from public.entries'))).length, 1);
  });

  await test('部外者は記録を読めない', async () => {
    equal((await as(STRANGER, () => rows('select * from public.entries'))).length, 0);
  });

  await test('部外者は記録を作れない', async () => {
    await fails(() => as(STRANGER, () => rows(`insert into public.entries (date) values ('2026-10-02')`)), '作れてしまった');
  });

  await test('未ログインでは記録を読めない', async () => {
    await fails(() => as(null, () => rows('select * from public.entries')), '読めてしまった');
  });

  await test('相手のコメントは、自分が書くまで読めない', async () => {
    await as(PARTNER, () => rows('insert into public.comments (entry_id, author_id, body) values ($1, $2, $3)', [entryId, PARTNER, '相手の本音']));
    const visible = await as(ME, () => rows('select body from public.comments where entry_id = $1', [entryId]));
    equal(visible, []);
  });

  await test('書いた事実だけは本文なしで分かる', async () => {
    const flags = await as(ME, () => rows('select * from public.comment_flags()'));
    equal(flags.map((flag) => flag.author_id), [PARTNER]);
    truthy(!('body' in flags[0]), '本文が含まれている');
  });

  await test('自分が書くと、相手のコメントが読める', async () => {
    await as(ME, () => rows('insert into public.comments (entry_id, author_id, body) values ($1, $2, $3)', [entryId, ME, '自分の本音']));
    const visible = await as(ME, () => rows('select body from public.comments where entry_id = $1 order by body', [entryId]));
    equal(visible.length, 2);
  });

  await test('なりすましてコメントを書けない', async () => {
    const other = await as(ME, () => rows(`insert into public.entries (date) values ('2026-10-03') returning id`));
    await fails(() => as(ME, () => rows('insert into public.comments (entry_id, author_id, body) values ($1, $2, $3)', [other[0].id, PARTNER, '偽物'])), '書けてしまった');
  });

  await test('相手のコメントを書き換えられない', async () => {
    const changed = await as(ME, () => rows(`update public.comments set body = '改ざん' where author_id = $1 returning id`, [PARTNER]));
    equal(changed, []);
  });

  await test('部外者は comment_flags を読めない', async () => {
    equal(await as(STRANGER, () => rows('select * from public.comment_flags()')), []);
  });

  await test('写真は部外者から読めない', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('photos', 'x.jpg')`);
    equal((await as(ME, () => rows('select name from storage.objects'))).length, 1);
    equal((await as(STRANGER, () => rows('select name from storage.objects'))).length, 0);
  });

  await test('写真の置き場所は非公開で作られる', async () => {
    equal(await rows(`select public from storage.buckets where id = 'photos'`), [{ public: false }]);
  });

  const events = (list) => JSON.stringify(list);

  await test('合言葉が違うとカレンダー同期を拒否する', async () => {
    await fails(() => as(null, () => rows(
      'select public.sync_calendar($1, $2::jsonb, $3, $4)',
      ['wrong', events([{ date: '2026-12-01' }]), '2026-11-01', '2027-01-01'],
    )), '通ってしまった');
  });

  await test('正しい合言葉なら「会う」の日が記録になる', async () => {
    await as(null, () => rows(
      'select public.sync_calendar($1, $2::jsonb, $3, $4)',
      [secret, events([{ date: '2026-12-01', end_date: '' }, { date: '2026-12-05', end_date: '2026-12-06' }]), '2026-11-01', '2027-01-01'],
    ));
    const synced = await rows(`select date::text, end_date::text, source from public.entries where date >= '2026-12-01' order by date`);
    equal(synced, [
      { date: '2026-12-01', end_date: null, source: 'calendar' },
      { date: '2026-12-05', end_date: '2026-12-06', source: 'calendar' },
    ]);
  });

  await test('予定が消えたら、何も書いていない日だけ消える', async () => {
    const kept = await rows(`select id from public.entries where date = '2026-12-05'`);
    await rows('insert into public.comments (entry_id, author_id, body) values ($1, $2, $3)', [kept[0].id, ME, '残す']);
    await as(null, () => rows(
      'select public.sync_calendar($1, $2::jsonb, $3, $4)',
      [secret, events([]), '2026-11-01', '2027-01-01'],
    ));
    const left = await rows(`select date::text from public.entries where date >= '2026-12-01' order by date`);
    equal(left, [{ date: '2026-12-05' }]);
  });

  await test('手動で作った記録は同期で消えない', async () => {
    await rows(`insert into public.entries (date, source) values ('2026-12-20', 'manual')`);
    await as(null, () => rows(
      'select public.sync_calendar($1, $2::jsonb, $3, $4)',
      [secret, events([]), '2026-11-01', '2027-01-01'],
    ));
    equal((await rows(`select 1 from public.entries where date = '2026-12-20'`)).length, 1);
  });

  await test('ログイン中の人も同期の入口は使えない', async () => {
    await fails(() => as(ME, () => rows(
      'select public.sync_calendar($1, $2::jsonb, $3, $4)',
      [secret, events([]), '2026-11-01', '2027-01-01'],
    )), '呼べてしまった');
  });

  await test('合言葉の保管場所にはアクセスできない', async () => {
    await fails(() => as(ME, () => rows('select * from private.sync_secret')), 'ログイン中の人が読めた');
    await fails(() => as(null, () => rows('select * from private.sync_secret')), '未ログインで読めた');
  });
}
