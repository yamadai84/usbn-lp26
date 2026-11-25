// シートの内容を GitHub の data/content.json に書き出す。
// トークンはスクリプトプロパティ GITHUB_TOKEN に保存し、コードには書かない。
// LPの申込フォームはウェブアプリ（doPost）で受け取り、「申込一覧」タブに追記する。

const GITHUB_REPO = 'yamadai84/usbn-lp26';
const CONTENT_PATH = 'data/content.json';
const LIST_TABS = {
  worries: 'お悩み',
  genres: 'ジャンル',
  reasons: '選ばれる理由',
  stats: '実績',
  schedule: '体験スケジュール',
  info: '体験概要',
  flow: '流れ',
  voices: '保護者の声',
  faq: 'よくある質問',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LP')
    .addItem('LPに反映', 'publish')
    .addItem('GitHubトークンを設定', 'setToken')
    .addToUi();
}

function setToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('GitHubトークンを設定', 'usbn-lp26 用のトークンを貼り付けてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = res.getResponseText().trim();
  if (!token) return;
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  ui.alert('トークンを保存しました。');
}

function publish() {
  const ui = SpreadsheetApp.getUi();
  try {
    const changed = saveToGitHub_(JSON.stringify(buildContent_(), null, 2) + '\n');
    ui.alert(changed ? 'GitHubに保存しました。1〜2分でLPに反映されます。' : '前回の反映から変更はありません。');
  } catch (err) {
    ui.alert('反映できませんでした', err.message, ui.ButtonSet.OK);
  }
}

function buildContent_() {
  const settings = {};
  readTab_('基本設定').forEach(row => { settings[row['項目']] = row['内容']; });
  if (!settings['ヒーロー見出し']) throw new Error('基本設定の「ヒーロー見出し」が空です。');
  const data = { settings };
  Object.keys(LIST_TABS).forEach(key => { data[key] = readTab_(LIST_TABS[key]); });
  return data;
}

// 非表示の行と未入力の行は公開するファイルに含めない
function readTab_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error(`「${name}」タブが見つかりません。`);
  const range = sheet.getDataRange();
  const raw = range.getValues();
  const shown = range.getDisplayValues();
  const headers = shown[0].map(h => h.trim());
  const rows = [];
  for (let r = 1; r < shown.length; r++) {
    const row = {};
    headers.forEach((h, c) => {
      if (!h) return;
      row[h] = h === '表示' ? String(raw[r][c]).toUpperCase() : shown[r][c].trim();
    });
    if (row['表示'] === 'FALSE') continue;
    if (Object.keys(row).some(k => k !== '表示' && row[k])) rows.push(row);
  }
  return rows;
}

// 内容が変わっていれば保存して true を返す
function saveToGitHub_(json) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('メニューの「GitHubトークンを設定」からトークンを入れてください。');
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${CONTENT_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const current = UrlFetchApp.fetch(`${url}?ref=main`, { headers, muteHttpExceptions: true });
  const code = current.getResponseCode();
  if (code !== 200 && code !== 404) throw new Error(githubError_(code));
  const file = code === 200 ? JSON.parse(current.getContentText()) : null;
  if (file) {
    const before = Utilities.newBlob(Utilities.base64Decode(file.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
    if (before === json) return false;
  }

  const payload = {
    message: 'シートの内容を反映',
    branch: 'main',
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
  };
  if (file) payload.sha = file.sha;
  const saved = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (saved.getResponseCode() >= 300) throw new Error(githubError_(saved.getResponseCode()));
  return true;
}

function githubError_(code) {
  if (code === 401) return 'トークンが無効か期限切れです。作り直して設定し直してください。';
  if (code === 403) return 'トークンに書き込み権限がありません。Contents を Read and write にしてください。';
  if (code === 404) return `リポジトリ ${GITHUB_REPO} が見つかりません。トークンの対象リポジトリを確認してください。`;
  return `GitHubへの保存に失敗しました（${code}）。少し待ってもう一度押してください。`;
}

// ---------- 申込フォームの受付 ----------

const ENTRY_TAB = '申込一覧';
const ENTRY_SETTINGS_TAB = '申込設定'; // LPには書き出さない
const ENTRY_HEADERS = ['受付日時', 'お子様のお名前', '電話番号', 'メールアドレス', '希望クラス・日程', 'ご質問・ご要望', '対応状況', '担当メモ'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function doGet() {
  return json_({ ok: true });
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // ボット対策の隠し項目に入力があれば、保存せず成功扱いにする
    if (data.website) return json_({ ok: true });
    const entry = validateEntry_(data);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      entrySheet_().appendRow([
        new Date(), safeCell_(entry.name), `'${entry.tel}`, safeCell_(entry.email),
        safeCell_(entry.summary), safeCell_(entry.message), '未対応', '',
      ]);
    } finally {
      lock.releaseLock();
    }
    // 保存できていれば、メールが送れなくても申込は成功として返す（二重送信を防ぐ）
    try {
      notify_(entry);
    } catch (err) {
      console.error(err);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: err.userMessage || '送信に失敗しました。時間をおいてもう一度お試しください。' });
  }
}

function validateEntry_(data) {
  const fail = msg => { const err = new Error(msg); err.userMessage = msg; throw err; };
  const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const name = text(data.name, 50);
  const tel = text(data.tel, 20).replace(/[^\d-]/g, '');
  const email = text(data.email, 120);
  const message = text(data.message, 1000);
  if (!name) fail('お子様のお名前を入力してください。');
  if (!/^0\d{9,10}$/.test(tel.replace(/-/g, ''))) fail('電話番号の形式を確認してください。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('メールアドレスの形式を確認してください。');

  // 選ばれたクラスが今のスケジュールにあるかを確かめる
  const schedule = readTab_(LIST_TABS.schedule);
  const picks = Array.isArray(data.picks) ? data.picks.slice(0, 20) : [];
  if (!picks.length) fail('体験したいクラスを選んでください。');
  const lines = picks.map(p => {
    const row = schedule.find(r => r['曜日'] === p.day && r['クラス'] === p.name && r['時間'] === p.time);
    if (!row) fail('選んだクラスの情報が古くなっています。ページを再読み込みして選び直してください。');
    const dates = (Array.isArray(p.dates) ? p.dates : []).slice(0, 10).map(d => {
      const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) fail('希望日の形式が正しくありません。');
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
    });
    return `${row['曜日']} ${row['クラス']} ${row['時間']}：${dates.length ? dates.join('、') : '日程は相談'}`;
  });
  return { name, tel, email, message, summary: lines.join('\n') };
}

function entrySheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(ENTRY_TAB);
  if (!sheet) {
    sheet = book.insertSheet(ENTRY_TAB);
    sheet.appendRow(ENTRY_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// =+-@ で始まる入力が数式として動かないようにする
function safeCell_(v) {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

function entrySettings_() {
  const settings = {};
  const sheet = SpreadsheetApp.getActive().getSheetByName(ENTRY_SETTINGS_TAB);
  if (!sheet) return settings;
  sheet.getDataRange().getDisplayValues().slice(1).forEach(r => { settings[String(r[0]).trim()] = String(r[1]).trim(); });
  return settings;
}

function notify_(entry) {
  const s = entrySettings_();
  const body = [
    `お子様のお名前：${entry.name}`,
    `電話番号：${entry.tel}`,
    `メールアドレス：${entry.email}`,
    '',
    '希望クラス・日程：',
    entry.summary,
    '',
    `ご質問・ご要望：${entry.message || 'なし'}`,
  ].join('\n');
  const to = s['通知先メールアドレス'];
  if (to) {
    MailApp.sendEmail({ to, subject: `【無料体験申込】${entry.name} 様`, body: `LPの申込フォームから申込がありました。\n\n${body}\n\n一覧：${SpreadsheetApp.getActive().getUrl()}`, replyTo: entry.email });
  }
  if (s['自動返信メール'] === 'する') {
    const sender = s['差出人名'] || 'URBAN SPORTS BASE NAGOYA';
    MailApp.sendEmail({
      to: entry.email,
      subject: `【${sender}】無料体験レッスンのお申し込みを受け付けました`,
      body: `${entry.name} 様の保護者様\n\n無料体験レッスンにお申し込みいただき、ありがとうございます。\n以下の内容で受け付けました。担当者より、確定日時をメールでご連絡します。\n\n${body}\n\nご不明な点は、このメールにご返信ください。\n\n${sender}`,
      name: sender,
      ...(to ? { replyTo: to } : {}),
    });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
