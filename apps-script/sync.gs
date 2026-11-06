// Google カレンダーの黄色い「会う」を、ふたりの日へ自動で反映する Google Apps Script。
// 定期実行で Supabase にアクセスするので、無料枠の休止を防ぐ役割も兼ねる。
//
// スクリプト プロパティに次の3つを登録する（README の手順4）。
//   SUPABASE_URL / SUPABASE_ANON_KEY / SYNC_SECRET

const MEET_TITLE = '会う';
const YELLOW_COLOR_ID = '5'; // Google カレンダーの「バナナ」
const DAYS_BACK = 14;
const DAYS_AHEAD = 180;
const TIME_ZONE = 'Asia/Tokyo';

// 黄色の「会う」を対象にする。色を個別に付けていない予定は、題名が「会う」ぴったりのときだけ対象にする。
function isMeetEvent(title, color) {
  const text = String(title || '').trim();
  if (color === YELLOW_COLOR_ID) return text.includes(MEET_TITLE);
  return !color && text === MEET_TITLE;
}

function toDateText(date) {
  return Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
}

function eventToDates(event) {
  if (event.isAllDayEvent()) {
    const start = event.getAllDayStartDate();
    // 終日予定の終了日は翌日を指すので1日戻す。
    const end = new Date(event.getAllDayEndDate().getTime() - 24 * 60 * 60 * 1000);
    const startText = toDateText(start);
    const endText = toDateText(end);
    return { date: startText, end_date: endText === startText ? '' : endText };
  }
  const startText = toDateText(event.getStartTime());
  const endText = toDateText(event.getEndTime());
  return { date: startText, end_date: endText === startText ? '' : endText };
}

function syncDates() {
  const props = PropertiesService.getScriptProperties();
  const dayMs = 24 * 60 * 60 * 1000;
  const from = new Date(Date.now() - DAYS_BACK * dayMs);
  const to = new Date(Date.now() + DAYS_AHEAD * dayMs);

  const byDate = {};
  for (const calendar of CalendarApp.getAllCalendars()) {
    for (const event of calendar.getEvents(from, to)) {
      if (isMeetEvent(event.getTitle(), event.getColor())) {
        const dates = eventToDates(event);
        byDate[dates.date] = dates;
      }
    }
  }

  const apiKey = props.getProperty('SUPABASE_ANON_KEY');
  const headers = { apikey: apiKey };
  // 旧形式の anon key (JWT) では Authorization も必要。新形式の publishable key では付けない。
  if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;

  const response = UrlFetchApp.fetch(`${props.getProperty('SUPABASE_URL')}/rest/v1/rpc/sync_calendar`, {
    method: 'post',
    contentType: 'application/json',
    headers,
    payload: JSON.stringify({
      p_secret: props.getProperty('SYNC_SECRET'),
      p_events: Object.values(byDate),
      p_from: toDateText(from),
      p_to: toDateText(to),
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    throw new Error(`同期に失敗しました: ${response.getResponseCode()} ${response.getContentText()}`);
  }
  console.log(`${Object.keys(byDate).length} 件の「会う」を同期しました`);
}

// 最初に1度だけ手動で実行すると、6時間ごとの自動実行が登録される。
function installTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(trigger);
  ScriptApp.newTrigger('syncDates').timeBased().everyHours(6).create();
  syncDates();
}
