// シートの内容を GitHub の data/content.json に書き出す。
// トークンはスクリプトプロパティ GITHUB_TOKEN に保存し、コードには書かない。

const GITHUB_REPO = 'yamadai84/usbn-lp';
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
  const res = ui.prompt('GitHubトークンを設定', 'usbn-lp 用のトークンを貼り付けてください。', ui.ButtonSet.OK_CANCEL);
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
