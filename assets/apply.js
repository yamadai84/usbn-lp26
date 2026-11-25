// ページ内の申込フォーム。送信先はシートに紐づく Apps Script のウェブアプリ。
window.UsbnApply = (() => {
  'use strict';

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const GENRE_CLASS = { 'ダブルダッチ': 'g-dd', 'ダンス': 'g-dance', 'アクロバット': 'g-acro' };
  const MAX_DATES = 6;
  const TIMEOUT_MS = 20000;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const rich = s => esc(s).replace(/\*\*(.+?)\*\*/gs, '<mark>$1</mark>').replace(/\n/g, '<br>');
  const toHalf = s => String(s || '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[ー−‐―]/g, '-').replace(/　/g, ' ');
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const label = d => `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  const genreClass = g => GENRE_CLASS[String(g || '').trim()] || 'g-other';

  let state = null;

  function weekdayOf(name) {
    const i = WEEKDAYS.indexOf(String(name || '').trim().charAt(0));
    return i < 0 ? null : i;
  }

  // 「2026/12/29, 12/30」のような休講日の書き方を ISO 日付の集合にする
  function parseHolidays(text, today) {
    const set = new Set();
    toHalf(text).split(/[,、\s]+/).forEach(part => {
      const m = part.match(/^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})$/);
      if (!m) return;
      let y = m[1] ? Number(m[1]) : today.getFullYear();
      const d = new Date(y, Number(m[2]) - 1, Number(m[3]));
      if (!m[1] && d < today) d.setFullYear(y + 1);
      set.add(iso(d));
    });
    return set;
  }

  function datesFor(weekday, s) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = Number(toHalf(s['最短の体験日（何日後から）'])) || 1;
    const range = Number(toHalf(s['受付期間（日数）'])) || 28;
    const holidays = parseHolidays(s['休講日'], today);
    const out = [];
    for (let i = from; i <= range && out.length < MAX_DATES; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      if (d.getDay() === weekday && !holidays.has(iso(d))) out.push(d);
    }
    return out;
  }

  function classes(schedule) {
    return schedule
      .map((r, i) => ({ id: String(i), day: r['曜日'], name: r['クラス'], time: r['時間'], genre: r['ジャンル'], weekday: weekdayOf(r['曜日']) }))
      .filter(c => c.weekday !== null && c.name);
  }

  function render(s, schedule) {
    const url = String(s['申込受付URL'] || '').trim();
    const list = classes(schedule);
    if (!/^(https:\/\/|http:\/\/localhost[:/])/.test(url) || !list.length) { state = null; return ''; }
    state = { url, s, list, picked: new Map() };

    const days = [];
    list.forEach(c => {
      let d = days.find(x => x.name === c.day);
      if (!d) days.push(d = { name: c.day, items: [] });
      d.items.push(c);
    });
    const policy = String(s['プライバシーポリシーURL'] || '').trim();

    return `<section class="sec sec-apply" id="apply">
      <div class="wrap wrap-narrow">
        <div class="sec-head on-dark">
          <span class="material-symbols-outlined" aria-hidden="true">edit_note</span>
          <p class="sec-en" lang="en">Entry</p>
          <span class="sec-bar"></span>
          <h2 class="sec-ja">${rich(s['フォーム見出し'] || '無料体験レッスン お申し込み')}</h2>
        </div>
        <div class="apply-card" id="applyCard">
          ${s['フォーム説明'] ? `<p class="apply-lead">${rich(s['フォーム説明'])}</p>` : ''}
          <form class="apply-form" id="applyForm" novalidate>
            <fieldset class="f-block" id="f-cls">
              <legend><span class="f-no" lang="en">1</span>体験したいクラス<span class="req">必須</span></legend>
              <p class="f-hint">複数選べます。${s['料金の注意'] ? rich(s['料金の注意']) : ''}</p>
              <div class="cls-days">
                ${days.map(d => `<div class="cls-day">
                  <p class="cls-day-name">${esc(d.name)}</p>
                  <div class="cls-list">
                    ${d.items.map(c => `<label class="cls ${genreClass(c.genre)}">
                      <input type="checkbox" name="cls" value="${c.id}">
                      <span class="cls-body">
                        <span class="cls-name">${esc(c.name)}</span>
                        <span class="cls-meta"><span class="cls-time" lang="en">${esc(c.time)}</span>${c.genre ? `<span class="cls-genre">${esc(c.genre)}</span>` : ''}</span>
                      </span>
                      <span class="cls-check material-symbols-outlined" aria-hidden="true">check</span>
                    </label>`).join('')}
                  </div>
                </div>`).join('')}
              </div>
              <p class="f-fee" id="feeNote" hidden></p>
              <p class="f-error" id="err-cls" role="alert"></p>
            </fieldset>

            <fieldset class="f-block" id="f-dates">
              <legend><span class="f-no" lang="en">2</span>希望日<span class="req">必須</span></legend>
              <p class="f-hint">行ける日をすべて選んでください。この中から日程を調整してご連絡します。</p>
              <div id="datePicks"><p class="f-empty">先に体験したいクラスを選んでください。</p></div>
              <p class="f-error" id="err-dates" role="alert"></p>
            </fieldset>

            <fieldset class="f-block">
              <legend><span class="f-no" lang="en">3</span>ご連絡先</legend>
              <div class="f-field">
                <label for="f-name">お子様のお名前<span class="req">必須</span></label>
                <input id="f-name" name="name" type="text" autocomplete="off" placeholder="山田 太郎" maxlength="50">
                <p class="f-error" id="err-name" role="alert"></p>
              </div>
              <div class="f-field">
                <label for="f-tel">電話番号<span class="req">必須</span></label>
                <input id="f-tel" name="tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="090-1234-5678" maxlength="20">
                <p class="f-error" id="err-tel" role="alert"></p>
              </div>
              <div class="f-field">
                <label for="f-email">メールアドレス<span class="req">必須</span></label>
                <input id="f-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="example@gmail.com" maxlength="120">
                <p class="f-note">確定日時はこのアドレスにお送りします。</p>
                <p class="f-error" id="err-email" role="alert"></p>
              </div>
            </fieldset>

            <fieldset class="f-block">
              <legend><span class="f-no" lang="en">4</span>ご質問・ご要望<span class="opt">任意</span></legend>
              <textarea id="f-message" name="message" rows="4" maxlength="1000" placeholder="例：兄弟2人で参加したい、学年、気になることなど"></textarea>
            </fieldset>

            <div class="f-hp" aria-hidden="true"><label>空欄のまま<input name="website" tabindex="-1" autocomplete="off"></label></div>

            <div class="f-agree">
              <label class="f-check"><input type="checkbox" id="f-agree" name="agree"><span>プライバシーポリシーに同意する</span></label>
              ${policy ? `<p class="f-policy"><a href="${esc(policy)}" target="_blank" rel="noopener">プライバシーポリシーを読む</a></p>` : ''}
              <p class="f-error" id="err-agree" role="alert"></p>
            </div>

            <p class="f-error f-submit-error" id="err-submit" role="alert"></p>
            <div class="center"><button class="btn btn-primary f-submit" type="submit">この内容で申し込む<span class="arrow" aria-hidden="true">→</span></button></div>
          </form>
        </div>
      </div>
    </section>`;
  }

  // ---------- 入力中の動き ----------

  function renderDates() {
    const box = document.getElementById('datePicks');
    if (!state.picked.size) {
      box.innerHTML = '<p class="f-empty">先に体験したいクラスを選んでください。</p>';
      return;
    }
    box.innerHTML = [...state.picked.values()].map(p => {
      const dates = datesFor(p.cls.weekday, state.s);
      return `<div class="pick ${genreClass(p.cls.genre)}">
        <p class="pick-title">${esc(p.cls.day)}　${esc(p.cls.name)}<span lang="en">${esc(p.cls.time)}</span></p>
        ${dates.length ? `<div class="date-list">
          ${dates.map(d => `<label class="date"><input type="checkbox" data-cls="${p.cls.id}" value="${iso(d)}" ${p.dates.has(iso(d)) ? 'checked' : ''}><span>${label(d)}</span></label>`).join('')}
        </div>` : '<p class="f-empty">受付中の日程がありません。ご質問・ご要望欄でご相談ください。</p>'}
      </div>`;
    }).join('');
  }

  function updateFee() {
    const note = document.getElementById('feeNote');
    const count = {};
    state.picked.forEach(p => { if (p.cls.genre) count[p.cls.genre] = (count[p.cls.genre] || 0) + 1; });
    const twice = Object.keys(count).filter(g => count[g] > 1);
    note.hidden = !twice.length;
    note.textContent = twice.length ? `${twice.join('・')}を複数選んでいます。同じジャンルの2回目からは体験料がかかります。` : '';
  }

  function setError(id, msg) {
    const el = document.getElementById(`err-${id}`);
    if (el) el.textContent = msg || '';
    const input = document.getElementById(`f-${id}`);
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }

  function normalizeTel(v) {
    return toHalf(v).replace(/[^\d-]/g, '');
  }

  function validate(form, all) {
    const errors = [];
    const check = (id, msg, field) => { if (!setError(id, msg)) errors.push(field || id); };

    if (all || state.touched.has('cls')) {
      check('cls', state.picked.size ? '' : '体験したいクラスを選んでください。', 'f-cls');
    }
    // 希望日はクラスを選んだ直後に責めないよう、送信時か、エラー表示中だけ確かめる
    if (all || document.getElementById('err-dates').textContent) {
      const missing = [...state.picked.values()].some(p => datesFor(p.cls.weekday, state.s).length && !p.dates.size);
      check('dates', missing ? '選んだクラスごとに、希望日を1つ以上選んでください。' : '', 'f-dates');
    }
    const name = form.name.value.trim();
    if (all || state.touched.has('name')) check('name', name ? '' : 'お子様のお名前を入力してください。');
    const tel = normalizeTel(form.tel.value).replace(/-/g, '');
    if (all || state.touched.has('tel')) {
      check('tel', !tel ? '電話番号を入力してください。' : /^0\d{9,10}$/.test(tel) ? '' : '電話番号の形式を確認してください（例：090-1234-5678）。');
    }
    const email = toHalf(form.email.value).trim();
    if (all || state.touched.has('email')) {
      check('email', !email ? 'メールアドレスを入力してください。' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'メールアドレスの形式を確認してください。');
    }
    if (all) check('agree', form.agree.checked ? '' : 'プライバシーポリシーへの同意が必要です。');
    return errors;
  }

  function payload(form) {
    return {
      name: form.name.value.trim(),
      tel: normalizeTel(form.tel.value),
      email: toHalf(form.email.value).trim(),
      message: form.message.value.trim(),
      website: form.website.value,
      picks: [...state.picked.values()].map(p => ({
        day: p.cls.day, name: p.cls.name, time: p.cls.time, genre: p.cls.genre || '',
        dates: [...p.dates].sort(),
      })),
    };
  }

  async function send(data) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // text/plain で送るとブラウザの事前確認が発生せず、Apps Script でも受け取れる
      const res = await fetch(state.url, { method: 'POST', body: JSON.stringify(data), signal: ctrl.signal });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || '送信に失敗しました。');
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  function showDone(data) {
    const card = document.getElementById('applyCard');
    const msg = state.s['完了メッセージ'] || 'お申し込みありがとうございます。\n担当者より、確定日時をメールでご連絡します。';
    card.innerHTML = `<div class="apply-done" tabindex="-1" id="applyDone">
      <span class="material-symbols-outlined done-icon" aria-hidden="true">check_circle</span>
      <p class="done-title">お申し込みを受け付けました</p>
      <p>${rich(msg)}</p>
      <dl class="done-sum">
        <div><dt>お名前</dt><dd>${esc(data.name)}</dd></div>
        ${data.picks.map(p => `<div><dt>${esc(p.day)} ${esc(p.name)}</dt><dd>${p.dates.length ? p.dates.map(d => esc(label(new Date(`${d}T00:00:00`)))).join('、') : 'ご相談'}</dd></div>`).join('')}
      </dl>
    </div>`;
    const done = document.getElementById('applyDone');
    done.scrollIntoView({ block: 'center' });
    done.focus({ preventScroll: true });
  }

  function mount() {
    const form = document.getElementById('applyForm');
    if (!state || !form) return;
    state.touched = new Set();

    // フォームを見ている間は、スマホ下部の申込ボタンを隠す
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        document.body.classList.toggle('in-apply', entries[0].isIntersecting);
      }, { rootMargin: '0px 0px -30% 0px' }).observe(document.getElementById('apply'));
    }

    form.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'cls') {
        const cls = state.list.find(c => c.id === t.value);
        if (t.checked) state.picked.set(cls.id, { cls, dates: new Set() });
        else state.picked.delete(cls.id);
        // 時間順に並べ直して表示する
        state.picked = new Map([...state.picked].sort((a, b) => Number(a[0]) - Number(b[0])));
        state.touched.add('cls');
        renderDates();
        updateFee();
        validate(form, false);
      } else if (t.dataset.cls) {
        const p = state.picked.get(t.dataset.cls);
        if (t.checked) p.dates.add(t.value); else p.dates.delete(t.value);
        validate(form, false);
      } else if (t.name === 'agree' && t.checked) {
        setError('agree', '');
      }
    });

    ['name', 'tel', 'email'].forEach(n => {
      form[n].addEventListener('blur', () => {
        if (n === 'tel') form.tel.value = normalizeTel(form.tel.value);
        if (n === 'email') form.email.value = toHalf(form.email.value).trim();
        if (form[n].value.trim()) state.touched.add(n);
        validate(form, false);
      });
      form[n].addEventListener('input', () => { if (state.touched.has(n)) validate(form, false); });
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      setError('submit', '');
      ['cls', 'name', 'tel', 'email'].forEach(n => state.touched.add(n));
      const errors = validate(form, true);
      if (errors.length) {
        const first = document.getElementById(errors[0].startsWith('f-') ? errors[0] : `f-${errors[0]}`);
        first.scrollIntoView({ block: 'start', behavior: 'smooth' });
        if (first.tagName === 'INPUT') first.focus({ preventScroll: true });
        return;
      }
      const button = form.querySelector('.f-submit');
      button.disabled = true;
      button.firstChild.textContent = '送信中…';
      const data = payload(form);
      try {
        await send(data);
        (window.dataLayer = window.dataLayer || []).push({ event: 'trial_apply_complete' });
        showDone(data);
      } catch (err) {
        console.error(err);
        setError('submit', err.name === 'AbortError' || err instanceof TypeError
          ? '送信できませんでした。通信環境を確認して、もう一度お試しください。'
          : err.message);
        button.disabled = false;
        button.firstChild.textContent = 'この内容で申し込む';
      }
    });
  }

  return { render, mount };
})();
