(() => {
  'use strict';

  const SHEET_ID = '19V2V1viJb56T9SEHa2_kY4-MIb7Ojdo8juRjQgqpk9E';
  const SHEET_TIMEOUT_MS = 4000;
  const FALLBACK_URL = 'data/content.json';
  const GTM_ID = 'GTM-P5QJLX5D';
  const GTM_HOST = 'urbansportsbase.com'; // 本番ドメイン以外では計測しない

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
  const DAY_COLORS = ['blue', 'purple', 'pink', 'yellow', 'coral', 'deep'];

  // ---------- データ取得 ----------

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function fetchTab(name, signal) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    const [header, ...rows] = parseCsv(await res.text());
    return rows.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || '').trim()])));
  }

  async function loadFromSheet() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SHEET_TIMEOUT_MS);
    try {
      const keys = Object.keys(LIST_TABS);
      const [settings, ...lists] = await Promise.all([
        fetchTab('基本設定', ctrl.signal),
        ...keys.map(k => fetchTab(LIST_TABS[k], ctrl.signal)),
      ]);
      const data = { settings: Object.fromEntries(settings.map(r => [r['項目'], r['内容']])) };
      keys.forEach((k, i) => { data[k] = lists[i]; });
      if (!data.settings['ヒーロー見出し']) throw new Error('基本設定が読み取れません');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadData() {
    try {
      return await loadFromSheet();
    } catch (err) {
      console.warn('スプレッドシートを読めなかったため控えのデータで表示します', err);
      const res = await fetch(FALLBACK_URL);
      return res.json();
    }
  }

  const visible = rows => rows.filter(r => String(r['表示']).toUpperCase() !== 'FALSE');

  // ---------- 変換 ----------

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // **強調** と改行だけを許可する
  const rich = s => esc(s).replace(/\*\*(.+?)\*\*/gs, '<mark>$1</mark>').replace(/\n/g, '<br>');

  function safeUrl(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u) || u.startsWith('#') || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    return '';
  }

  // Googleドライブの共有リンクは画像として直接表示できる形に直す
  function imageUrl(url) {
    const u = safeUrl(url);
    const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=|thumbnail\?(?:.*&)?id=)([\w-]+)/);
    return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w1600` : u;
  }

  const img = (url, alt, attrs = '') => {
    const src = imageUrl(url);
    return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" ${attrs}>` : '';
  };

  const icon = name => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
  const pad2 = n => String(n).padStart(2, '0');

  function sectionHead(iconName, en, title, tone = '') {
    return `<div class="sec-head ${tone}">
      ${icon(iconName)}
      <p class="sec-en" lang="en">${esc(en)}</p>
      <span class="sec-bar"></span>
      <h2 class="sec-ja">${rich(title)}</h2>
    </div>`;
  }

  // ---------- 各セクション ----------

  function ctaButton(s) {
    return `<a class="btn btn-primary js-cta" href="#trial">${esc(s['申込ボタン文言'])}<span class="arrow" aria-hidden="true">→</span></a>`;
  }

  function hero(s) {
    const pc = imageUrl(s['ヒーロー画像URL（PC）']);
    const sp = imageUrl(s['ヒーロー画像URL（スマホ）']) || pc;
    const campaign = s['キャンペーンラベル'] ? `
      <div class="campaign">
        <span class="tag">${esc(s['キャンペーンラベル'])}</span>
        <p class="campaign-title">${rich(s['キャンペーン見出し'])}</p>
        <p class="campaign-note">${rich(s['キャンペーン補足'])}</p>
        <a class="btn btn-primary" href="#trial">今すぐ無料体験の詳細へ<span class="arrow" aria-hidden="true">→</span></a>
      </div>` : '';
    return `<section class="hero">
      ${pc ? `<picture class="hero-img">
        <source media="(max-width: 540px)" srcset="${esc(sp)}">
        <img src="${esc(pc)}" alt="Play the Streets, Shape the Future" fetchpriority="high">
      </picture>` : ''}
      <div class="hero-body">
        <div class="hero-copy">
          <p class="hero-eyebrow">${rich(s['ヒーロー小見出し'])}</p>
          <h1 class="hero-title">${rich(s['ヒーロー見出し'])}</h1>
          <p class="hero-lead">${rich(s['ヒーロー本文'])}</p>
          <p class="hero-genres" lang="en">${esc(s['ジャンル帯'])}</p>
        </div>
        ${campaign}
      </div>
    </section>`;
  }

  function worries(s, rows) {
    if (!rows.length) return '';
    return `<section class="sec sec-white" id="worries">
      <div class="wrap">
        ${sectionHead('help', 'Worries', s['お悩み見出し'])}
        <div class="worry-grid">
          ${rows.map((r, i) => `<article class="worry">
            ${img(r['写真URL'], '')}
            <div class="worry-text">
              <span class="worry-no" lang="en">${pad2(i + 1)}</span>
              <p>${rich(r['お悩み'])}</p>
            </div>
          </article>`).join('')}
        </div>
      </div>
      <p class="solve">${rich(s['解決メッセージ'])}</p>
    </section>`;
  }

  function genres(s, rows) {
    if (!rows.length) return '';
    return `<section class="sec sec-tint" id="class">
      <div class="wrap wrap-narrow">
        ${sectionHead('location_city', 'Class', s['ジャンル見出し'])}
        <div class="genre-list">
          ${rows.map(r => `<article class="genre">
            <div class="genre-img">${img(r['写真URL'], r['名前'])}</div>
            <div class="genre-text">
              <p class="genre-en" lang="en">${esc(r['英語名'])}</p>
              <h3>${rich(r['名前'])}</h3>
              <p>${rich(r['説明'])}</p>
            </div>
          </article>`).join('')}
        </div>
      </div>
    </section>`;
  }

  function reasons(s, rows) {
    if (!rows.length) return '';
    return `<section class="sec sec-white" id="reason">
      <div class="wrap">
        ${sectionHead('verified', 'Reason', s['理由見出し'])}
        <div class="reason-grid">
          ${rows.map((r, i) => `<article class="reason">
            <span class="reason-no" lang="en">${pad2(i + 1)}</span>
            <h3>${rich(r['見出し'])}</h3>
            <p>${rich(r['本文'])}</p>
          </article>`).join('')}
        </div>
      </div>
    </section>`;
  }

  function studio(s, stats) {
    const photo = imageUrl(s['実績背景写真URL']);
    const bg = photo ? ` style="--bg:url('${esc(photo).replace(/'/g, '%27')}')"` : '';
    return `<section class="sec sec-deep" id="studio"${bg}>
      <div class="wrap">
        ${sectionHead('place', 'Studio', s['場所見出し'], 'on-dark')}
        <div class="studio-body">
          ${img(s['場所写真URL'], 'URBAN SPORTS BASE NAGOYA のスタジオ', 'class="studio-photo"')}
          <p class="studio-msg">${rich(s['場所メッセージ'])}</p>
        </div>
        ${stats.length ? `<div class="stat-grid">
          ${stats.map(r => `<div class="stat">
            <p class="stat-label">${rich(r['ラベル'])}</p>
            <p class="stat-num"><span lang="en">${esc(r['数字'])}</span><small>${esc(r['単位'])}</small></p>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </section>`;
  }

  function trial(s, schedule, info) {
    const days = [];
    schedule.forEach(r => {
      let d = days.find(x => x.name === r['曜日']);
      if (!d) days.push(d = { name: r['曜日'], items: [] });
      d.items.push(r);
    });
    return `<section class="sec sec-white" id="trial">
      <div class="wrap wrap-narrow">
        ${sectionHead('celebration', 'Free Trial', s['体験見出し'])}
        <p class="trial-lead">${rich(s['体験本文'])}</p>
        ${days.length ? `<div class="day-grid">
          ${days.map((d, i) => `<article class="day day-${DAY_COLORS[i % DAY_COLORS.length]}">
            <h3>${esc(d.name)}</h3>
            <ul>${d.items.map(r => `<li><span class="day-class">${esc(r['クラス'])}</span><span class="day-time" lang="en">${esc(r['時間'])}</span></li>`).join('')}</ul>
          </article>`).join('')}
        </div>` : ''}
        ${img(s['スケジュール補足画像URL'], '体験レッスンスケジュール', 'class="flyer"')}
        ${info.length ? `<dl class="info">
          ${info.map(r => {
            const link = safeUrl(r['リンクURL']);
            const body = rich(r['内容']);
            return `<div><dt>${esc(r['項目'])}</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${body}${icon('open_in_new')}</a>` : body}</dd></div>`;
          }).join('')}
        </dl>` : ''}
        <div class="center">${ctaButton(s)}</div>
      </div>
    </section>`;
  }

  function flow(s, rows) {
    if (!rows.length) return '';
    return `<section class="sec sec-tint" id="flow">
      <div class="wrap">
        ${sectionHead('format_list_numbered', 'Flow', s['流れ見出し'])}
        <ol class="flow-list">
          ${rows.map((r, i) => `<li class="step">
            <span class="step-no" lang="en"><small>STEP</small>${i + 1}</span>
            <h3>${rich(r['見出し'])}</h3>
            <p>${rich(r['本文'])}</p>
          </li>`).join('')}
        </ol>
      </div>
    </section>`;
  }

  function voices(s, rows) {
    if (!rows.length) return '';
    return `<section class="sec sec-white" id="voice">
      <div class="wrap">
        ${sectionHead('chat', 'Voice', s['声見出し'])}
        <div class="voice-grid">
          ${rows.map(r => `<article class="voice">
            ${img(r['写真URL'], '', 'class="voice-img" width="72" height="72"')}
            <div>
              <h3>${rich(r['見出し'])}</h3>
              <p>${rich(r['本文'])}</p>
            </div>
          </article>`).join('')}
        </div>
      </div>
    </section>`;
  }

  function faq(s, rows) {
    if (!rows.length) return '';
    return `<section class="sec sec-gray" id="faq">
      <div class="wrap wrap-narrow">
        ${sectionHead('quiz', 'Q&A', s['質問見出し'])}
        <div class="faq-list">
          ${rows.map(r => `<details class="faq">
            <summary><span class="faq-q" lang="en">Q</span><span class="faq-title">${rich(r['質問'])}</span>${icon('add')}</summary>
            <div class="faq-a"><span class="faq-q faq-q-a" lang="en">A</span><p>${rich(r['回答'])}</p></div>
          </details>`).join('')}
        </div>
      </div>
    </section>`;
  }

  function closing(s) {
    return `<section class="closing">
      <div class="closing-img">${img(s['締め写真URL'], '')}</div>
      <div class="closing-body">
        ${img(s['ロゴ画像URL（濃い背景用）'], 'DDFAM / URBAN SPORTS BASE', 'class="closing-logo"')}
        <h2>${rich(s['締め見出し'])}</h2>
        <p>${rich(s['締め本文'])}</p>
        ${ctaButton(s)}
      </div>
    </section>`;
  }

  function footer(s) {
    const links = [
      ['URBAN SPORTS BASE 公式サイト', s['本サイトURL']],
      ['Instagram', s['InstagramURL']],
      ['Google Map', s['GoogleマップURL']],
      ['プライバシーポリシー', s['プライバシーポリシーURL']],
    ].filter(l => safeUrl(l[1]));
    return `<footer class="site-footer">
      <ul>${links.map(([t, u]) => `<li><a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul>
      <p lang="en">${esc(s['コピーライト'])}</p>
    </footer>`;
  }

  // ---------- 描画 ----------

  function setMeta(s) {
    if (s['ページタイトル']) {
      document.title = s['ページタイトル'];
      document.querySelector('meta[property="og:title"]').content = s['ページタイトル'];
    }
    if (s['ページ説明']) {
      document.querySelector('meta[name="description"]').content = s['ページ説明'];
      document.querySelector('meta[property="og:description"]').content = s['ページ説明'];
    }
  }

  function applyCtas(s) {
    const form = safeUrl(s['申込フォームURL']);
    document.querySelectorAll('.js-cta').forEach(a => {
      if (!form) return;
      a.href = form;
      a.target = '_blank';
      a.rel = 'noopener';
    });
    const short = s['ヘッダーボタン文言'] || s['申込ボタン文言'];
    const header = document.getElementById('headerCta');
    header.textContent = short;
    header.hidden = false;
    const spBar = document.getElementById('spCta');
    spBar.querySelector('a').textContent = short;
    spBar.hidden = false;
  }

  function render(data) {
    const s = data.settings;
    setMeta(s);
    const logo = document.getElementById('headerLogo');
    const logoSrc = imageUrl(s['ロゴ画像URL']);
    if (logoSrc) { logo.src = logoSrc; logo.hidden = false; }

    document.getElementById('app').innerHTML = [
      hero(s),
      worries(s, visible(data.worries)),
      genres(s, visible(data.genres)),
      reasons(s, visible(data.reasons)),
      studio(s, visible(data.stats)),
      trial(s, visible(data.schedule), visible(data.info)),
      flow(s, visible(data.flow)),
      voices(s, visible(data.voices)),
      faq(s, visible(data.faq)),
      closing(s),
      footer(s),
    ].join('');
    applyCtas(s);
    document.body.classList.add('ready');

    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  function loadGtm() {
    const host = location.hostname;
    if (host !== GTM_HOST && !host.endsWith('.' + GTM_HOST)) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
    document.head.appendChild(script);
  }

  loadGtm();
  loadData().then(render).catch(err => {
    console.error(err);
    document.getElementById('app').innerHTML = '<p class="load-error">ページを読み込めませんでした。時間をおいて再度お試しください。</p>';
  });
})();
