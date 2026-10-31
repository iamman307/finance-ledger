
(function () {
'use strict';
const E = window.FinEngine;
const S = { db: null, loaded: { raw: false, cfg: false, ovr: false, manual: false, nw: false }, raw: [], config: null, ovr: [], manual: [], nw: {}, res: null,
  month: null, tab: 'home', q: '', filter: 'all', import: null, flowYear: null };
try { const t = localStorage.getItem('fin.tab'); if (t) S.tab = t; } catch (e) {}
// 主畫面圖示長按的捷徑：?go=quick｜camera｜recon｜list…
const GO = new URLSearchParams(location.search).get('go');
if (GO && ['home', 'flow', 'recon', 'list', 'assets', 'data'].includes(GO)) S.tab = GO;
if (GO) history.replaceState(null, '', location.pathname);

// ---------------------------------------------------------------- helpers
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const sgn = n => (n > 0 ? '+' : '') + fmt(n);
const pct = n => (n == null || !isFinite(n)) ? '—' : (n * 100).toFixed(1) + '%';
const wan = n => Math.abs(n) >= 10000 ? (n / 10000).toFixed(Math.abs(n) >= 100000 ? 0 : 1) + '萬' : fmt(n);
const mLabel = m => m ? `${m.slice(0, 4)}年${+m.slice(5)}月` : '';
const TYPE_ZH = { Expense: '支出', Income: '收入', Transfer: '轉帳', Investment: '投資', Debt: '負債', Adjustment: '調整', Pending: '待分類', Unknown: '未知' };
const hashId = (p, s) => p + '-' + E.util.hash(s) + E.util.hash(s.split('').reverse().join(''));
function toast(msg) { const r = $('#toast-root'); r.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => r.innerHTML = '', 2600); }
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9l8-5 8 5v10"/><path d="M9 19v-6h6v6"/></svg>',
  flow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  recon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  assets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v12H3z"/><path d="M16 13h2M3 7l3-3h12l3 3"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
};
const TABS = [['home', '總覽'], ['flow', '收支'], ['recon', '對帳'], ['list', '明細'], ['assets', '資產'], ['data', '匯入']];

// ---------------------------------------------------------------- data
function recompute() {
  if (!S.config) { S.res = null; return; }
  try {
    S.res = E.compute({ files: S.raw, config: S.config, ovr: S.ovr, manual: S.manual });
  } catch (e) { console.error(e); S.res = null; S.err = e.message; }
  const months = monthsAvailable();
  if (!S.month || !months.includes(S.month)) S.month = months[months.length - 1] || null;
}
function monthsAvailable() {
  const set = new Set();
  for (const f of S.raw) if (f.kind === 'app' || f.kind === 'bank') set.add(f.month);
  for (const m of S.manual) if (m.date) set.add(m.date.slice(0, 7));
  if (set.size) set.add(todayISO().slice(0, 7));
  return [...set].filter(Boolean).sort();
}
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GH_KEY = 'fin.gh';
function ghSettings() { try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch (e) { return null; } }
const STATUS_ZH = { loading: '讀取中…', saving: '儲存中…', synced: '已同步', offline: '離線（顯示上次的資料）', error: '儲存失敗', idle: '' };
async function boot() {
  const gh = ghSettings();
  if (!gh || !gh.token) { renderSetup(); return; }
  const store = new window.GitStore(gh);
  S.db = store;
  store.onStatus = (st, detail) => {
    S.syncState = st; S.syncDetail = detail || '';
    $('#sync').textContent = `${S.raw.length} 個原始檔 · ${STATUS_ZH[st] || st}`;
    if (st === 'error') toast('儲存到 GitHub 失敗：' + (detail || '') + '（到「匯入」頁可重試）');
    if (st === 'offline' && !S.offlineTold) { S.offlineTold = true; toast('沒有網路：記的帳先存在手機，連上網路後會自動同步'); }
    if (st === 'synced') S.offlineTold = false;
    const fab = document.getElementById('fab'); if (fab) fab.dataset.state = st;
  };
  try { await store.checkAccess(); await store.load(); store.restorePending(); }
  catch (e) {
    if (e.code === 'unauthenticated' || e.code === 'not_found' || e.code === 'public_repo' || e.code === 'forbidden') { renderSetup(e.message); return; }
    const n = store.loadFromCache();
    store.restorePending();
    store.setStatus('offline', '沒有網路，顯示上次的資料；新記的會先存在這台裝置');
    if (!n) { $('#view').innerHTML = `<div class="panel empty"><b>連不上 GitHub</b><span class="sub">${esc(e.message)}</span><button class="btn" onclick="location.reload()">重試</button></div>`; return; }
  }
  const docs = s => s.docs.map(d => ({ _id: d.id, ...d.data() }));
  store.collection('raw').onSnapshot(s => { S.raw = docs(s); S.loaded.raw = true; changed(); });
  store.doc('config/main').onSnapshot(s => { S.config = s.exists ? s.data() : null; S.loaded.cfg = true; changed(); });
  store.collection('ovr').onSnapshot(s => { S.ovr = docs(s); S.loaded.ovr = true; changed(); });
  store.collection('manual').onSnapshot(s => { S.manual = docs(s); S.loaded.manual = true; changed(); });
  store.collection('nw').onSnapshot(s => { S.nw = Object.fromEntries(docs(s).map(d => [d._id, d])); S.loaded.nw = true; changed(); });
  setTimeout(() => syncStockLedger(false), 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { store.retry().catch(() => {}).then(() => store.refresh()); syncStockLedger(false); } });
  window.addEventListener('online', () => store.retry().catch(() => {}).then(() => store.refresh()));
  setInterval(() => { if (document.visibilityState === 'visible') store.refresh(); }, 90000);
}
function renderSetup(err) {
  const gh = ghSettings() || {};
  const owner = gh.owner || (location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '');
  $('#sync').textContent = '尚未連線';
  $('#tabs').innerHTML = ''; $('#monthpick').hidden = true;
  $('#view').innerHTML = `<h1 class="view">連接你的帳本資料</h1>
  <section class="panel"><header><h2>資料存在你的私人 GitHub repo</h2></header>
    <p class="sub" style="margin:0">這個網頁本身是公開的，但裡面沒有任何數字。你的帳本放在 Private repo，網頁用你的 token 讀寫；token 只存在這台裝置的瀏覽器裡。手機和電腦各設定一次。</p>
    ${err ? `<div class="callout">${esc(err)}</div>` : ''}
    <form class="form" id="ghform">
      <div class="fields2"><div class="field"><label for="gh-owner">GitHub 帳號</label><input id="gh-owner" name="owner" value="${esc(owner)}" autocapitalize="off"></div>
      <div class="field"><label for="gh-repo">資料 repo</label><input id="gh-repo" name="repo" value="${esc(gh.repo || 'finance-data')}" autocapitalize="off"></div></div>
      <div class="field"><label for="gh-token">Fine-grained token</label><input id="gh-token" name="token" type="password" autocomplete="off" placeholder="github_pat_…" value=""></div>
    </form>
    <details><summary>怎麼建立 token</summary><ol class="sub" style="margin:6px 0 0;padding-left:20px;display:grid;gap:4px">
      <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
      <li>Repository access 選 <b>Only select repositories</b>，只勾資料 repo</li>
      <li>Permissions → Repository permissions → <b>Contents：Read and write</b>（其他都不用）</li>
      <li>Expiration 可選一年；過期後回來這頁貼新的就好</li></ol></details>
    <div style="display:flex;justify-content:flex-end"><button class="btn primary" data-act="ghsave">連線</button></div>
  </section>`;
}
let pend = 0;
function changed() {
  if (!Object.values(S.loaded).every(Boolean)) return;
  cancelAnimationFrame(pend);
  pend = requestAnimationFrame(() => {
    recompute(); render(); $('#sync').textContent = `${S.raw.length} 個原始檔 · ${STATUS_ZH[S.syncState] || '已同步'}`;
    if ((GO === 'quick' || GO === 'camera') && !S.goDone && S.res) { S.goDone = true; sheetQuick(); if (GO === 'camera') setTimeout(() => { const c = $('#q-cam'); if (c) c.click(); }, 300); }
  });
}
async function write(path, data) {
  try { await S.db.doc(path).set(data); return true; }
  catch (e) { toast('儲存失敗：' + (e.message || e.code)); return false; }
}
function confirmTwice(btn, msg) { if (btn.dataset.confirm) return true; btn.dataset.confirm = '1'; btn.textContent = msg; return false; }
async function remove(path) {
  try { await S.db.doc(path).delete(); return true; } catch (e) { toast('刪除失敗：' + (e.message || e.code)); return false; }
}

// ---------------------------------------------------------------- derived
function monthState(m) {
  const r = S.res; if (!r) return null;
  const files = S.raw.filter(f => f.month === m);
  const appN = files.filter(f => f.kind === 'app').length;
  const mega = files.filter(f => f.kind === 'bank' && f.bank === '兆豐').length;
  const esun = files.filter(f => f.kind === 'bank' && f.bank === '玉山').length;
  const card = S.raw.some(f => f.kind === 'card' && f.month === m) || r.card.some(c => c.month === m);
  const pending = r.issues.filter(i => i.type === '銀行待分類' && i.month === m).length;
  const rc = r.recon.filter(x => x.month === m);
  const cardOpen = rc.filter(x => ['需人工確認', 'APP有卡無', '卡有APP無'].includes(x.status)).length;
  const bankExp = r.issues.filter(i => i.type === 'BANK支出待確認' && i.month === m).length;
  const appBad = r.issues.filter(i => ['APP資料異常', '未分類帳本', '設定錯誤'].includes(i.type) && i.month === m).length;
  const nw = S.nw[m];
  return { appN, mega, esun, card, pending, cardOpen, bankExp, appBad, nw, rc };
}
function openCount() {
  if (!S.res || !S.month) return 0;
  const st = monthState(S.month);
  return st.pending + st.cardOpen + st.bankExp + st.appBad;
}

// ---------------------------------------------------------------- render shell
function render() {
  const months = monthsAvailable();
  const mp = $('#monthpick');
  mp.hidden = !months.length;
  $('#month-select').innerHTML = months.map(m => `<option value="${m}" ${m === S.month ? 'selected' : ''}>${mLabel(m)}</option>`).join('');
  const oc = openCount();
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button type="button" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${ICON[k]}<span>${l}</span>${k === 'recon' && oc ? `<span class="badge">${oc}</span>` : ''}</button>`).join('');
  if (!document.getElementById('fab')) { const b = document.createElement('button'); b.id = 'fab'; b.type = 'button'; b.dataset.act = 'quick'; b.setAttribute('aria-label', '記一筆'); b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'; document.body.appendChild(b); }
  const v = $('#view');
  if (!S.config && S.tab !== 'data') { v.innerHTML = emptySetup(); return; }
  if (!S.res && S.tab !== 'data') { v.innerHTML = `<div class="panel empty"><b>計算時發生錯誤</b><span class="sub">${esc(S.err || '')}</span></div>`; return; }
  const fn = { home: viewHome, flow: viewFlow, recon: viewRecon, list: viewList, assets: viewAssets, data: viewData }[S.tab] || viewHome;
  v.innerHTML = fn();
  if (S.tab === 'home') bindChart();
}
function emptySetup() {
  return `<div class="panel empty"><b>資料 repo 是空的</b><span class="sub">找不到 state.json。如果你有備份 JSON，可以到「匯入」頁還原。</span><button class="btn" data-tab="data">前往匯入</button></div>`;
}

// ---------------------------------------------------------------- HOME
function viewHome() {
  const m = S.month; if (!m) return `<div class="panel empty"><b>還沒有任何資料</b><span class="sub">到「匯入」選擇 D:\\Finance 資料夾。</span><button class="btn primary" data-tab="data">前往匯入</button></div>`;
  const st = monthState(m);
  const s = E.monthStats(S.res.ledger, m, S.config.debts || []);
  const chk = (ok, label, detail, act) => `<div class="check"><span class="dot ${ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'bad'}">${ok === true ? '✓' : '!'}</span><span>${label}<br><span class="sub">${detail}</span></span>${act || ''}</div>`;
  const allOk = st.appN && st.mega && st.esun && st.card && !st.pending && !st.cardOpen && !st.appBad;
  const nwStatus = st.nw ? (st.nw.status === '已確認' ? true : 'warn') : false;
  const ex1 = s.oneOffIncome ? `含分紅／獎金 ${fmt(s.oneOffIncome)}` : '';
  const exBal = s.oneOffIncome ? `不含分紅／獎金 ${sgn(s.balance - s.oneOffIncome)}` : '';
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
    <h1 class="view">${mLabel(m)}</h1>
    <span class="pill ${allOk ? 'ok' : 'warn'}">${allOk ? '月結資料齊全' : '月結尚未完成'}</span>
  </div>
  <div class="kpis">
    <div class="kpi"><span class="lbl">收入</span><span class="val">${fmt(s.income)}</span><span class="note">${ex1 || '本人＋家庭資金轉入'}</span></div>
    <div class="kpi"><span class="lbl">生活消費</span><span class="val">${fmt(s.expense)}</span><span class="note">必要 ${pct(s.expense ? s.essential / s.expense : 0)} · 固定 ${pct(s.expense ? s.fixed / s.expense : 0)}</span></div>
    <div class="kpi"><span class="lbl">生活結餘</span><span class="val ${s.balance < 0 ? 'negv' : ''}">${sgn(s.balance)}</span><span class="note">${exBal || '儲蓄率 ' + pct(s.savingsRate)}</span></div>
    <div class="kpi"><span class="lbl">扣債務後可自由配置</span><span class="val ${s.free < 0 ? 'negv' : ''}">${sgn(Math.round(s.free))}</span><span class="note">分期與貸款月付 ${fmt(Math.round(s.debtCash))}</span></div>
  </div>
  ${tripPanel()}
  ${budgetPanel(m)}
  <div class="grid2">
    <section class="panel"><header><h2>月結檢查</h2><span class="sub">${mLabel(m)}</span></header>
      <div class="checks">
        ${chk(st.appN > 0, '記帳 APP', st.appN ? `${st.appN} 個帳本已匯入` : '尚未匯入', st.appN ? '' : '<button class="linkbtn act" data-tab="data">匯入</button>')}
        ${chk(st.mega > 0 && st.esun > 0, '兆豐・玉山存款明細', `兆豐 ${st.mega} 檔・玉山 ${st.esun} 檔`, st.mega && st.esun ? '' : '<button class="linkbtn act" data-tab="data">匯入</button>')}
        ${chk(st.card ? true : 'warn', '玉山信用卡帳單', st.card ? '已匯入' : '下個月初帳單寄來後匯入', '')}
        ${chk(st.pending ? false : true, '銀行交易分類', st.pending ? `${st.pending} 筆待分類（會擋月結）` : '全部已分類', st.pending ? '<button class="linkbtn act" data-tab="recon">處理</button>' : '')}
        ${chk(st.cardOpen ? 'warn' : true, '信用卡對帳', st.cardOpen ? `${st.cardOpen} 筆待確認` : (st.card ? '全部配對完成' : '等待帳單'), st.cardOpen ? '<button class="linkbtn act" data-tab="recon">處理</button>' : '')}
        ${chk(nwStatus, '月底資產負債', st.nw ? `Net Worth ${fmt(nwTotals(st.nw).net)}・${esc(st.nw.status || '暫估')}` : '尚未填寫', '<button class="linkbtn act" data-tab="assets">' + (st.nw ? '查看' : '填寫') + '</button>')}
      </div>
    </section>
    <section class="panel"><header><h2>本月支出結構</h2><span class="sub num">${fmt(s.expense)}</span></header>
      ${catBars(s)}
    </section>
  </div>
  <section class="panel"><header><h2>${m.slice(0, 4)} 每月收入與生活消費</h2>
    <div class="legend"><span><i style="background:var(--income)"></i>收入</span><span><i style="background:var(--expense)"></i>生活消費</span></div></header>
    <div class="chart" id="trend">${trendSvg(m.slice(0, 4))}</div>
  </section>`;
}
// ---------------------------------------------------------------- 代墊對象
function whoRow(n = '', a = '') { return `<div class="whorow"><input class="who-n" list="wholist" value="${esc(n)}" placeholder="名字" autocomplete="off"><input class="who-a" inputmode="decimal" value="${a}" placeholder="金額（空白＝平分）"><button type="button" class="whodel" data-act="whodel" aria-label="移除">✕</button></div>`; }
function whoEditor(id, people) {
  const rows = people && people.length ? people : [{ who: '', amt: null }];
  const names = E.whoNames(S.res ? S.res.receivables : []).slice(0, 8);
  ensureWhoList();
  return `<div class="field whofield"><label>代墊對象</label><div class="whobox" id="${id}">${rows.map(p => whoRow(p.who || '', rows.length > 1 && p.amt != null ? Math.round(p.amt) : '')).join('')}</div>
    <div class="chips whonames">${names.map(n => `<button type="button" class="chip" data-act="whopick" data-n="${esc(n)}">${esc(n)}</button>`).join('')}<button type="button" class="chip" data-act="whoadd">＋再加一個人</button></div></div>`;
}
function ensureWhoList() {
  let dl = document.getElementById('wholist');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'wholist'; document.body.appendChild(dl); }
  dl.innerHTML = E.whoNames(S.res ? S.res.receivables : []).map(n => `<option value="${esc(n)}">`).join('');
}
function rowPeople(r) {
  const rv = S.res.receivables.find(x => x.key === r.key);
  if (rv) return rv.people.filter(p => !/^（/.test(p.who));
  return r.splitWith ? [{ who: E.whoName(r.splitWith), amt: null }] : [];
}
// 金額字串 → 台幣；有 ¥ 或 円 時用匯率換算，否則用 conv（例如旅行時整張單是日圓）
function moneyTwd(str, rate, conv) {
  const raw = String(str ?? '').trim(); if (!raw) return null;
  const yen = /[¥￥円]/.test(raw); const v = E.calcAmount(raw.replace(/[¥￥円]/g, ''));
  if (v == null || isNaN(v)) return NaN;
  if (yen && rate) return Math.round(v * rate);
  return conv ? conv(v) : v;
}
// 讀代墊對象：回傳 {splits, splitWith, myShare} 或 {err}
function readWho(box, total, myShare, rate, conv) {
  const rows = box ? [...box.querySelectorAll('.whorow')].map(el => ({ who: E.whoName(el.querySelector('.who-n').value), a: el.querySelector('.who-a').value })).filter(x => x.who) : [];
  if (!rows.length) return { splits: null, splitWith: null, myShare };
  for (const x of rows) { x.amt = x.a.trim() === '' ? null : moneyTwd(x.a, rate, conv); if (x.amt != null && (isNaN(x.amt) || x.amt < 0)) return { err: `${x.who} 的金額看不懂` }; }
  const given = rows.filter(x => x.amt != null).reduce((a, x) => a + x.amt, 0), blanks = rows.filter(x => x.amt == null);
  if (myShare == null) {
    if (blanks.length) return { err: '填「我負擔金額」，或每個人各自的金額' };
    myShare = Math.round((total - given) * 100) / 100;
    if (myShare < -1) return { err: `代墊加起來 ${fmt(given)}，比總額 ${fmt(total)} 還多` };
    myShare = Math.max(0, myShare);
  } else {
    const rest = Math.round((total - myShare - given) * 100) / 100;
    if (blanks.length) { if (rest < 0) return { err: `我負擔＋代墊已經超過總額 ${fmt(total)}` }; for (const b of blanks) b.amt = Math.round(rest / blanks.length); }
    else if (Math.abs(rest) > 1) return { err: `金額對不上：總額 ${fmt(total)} − 我 ${fmt(myShare)} − 代墊 ${fmt(given)} ＝ ${rest > 0 ? '還差 ' : '多了 '}${fmt(Math.abs(rest))}` };
  }
  const splits = rows.map(x => ({ who: x.who, amt: Math.round(x.amt) }));
  return { myShare, splits, splitWith: splits.length === 1 ? splits[0].who : splits.map(x => `${x.who} ${fmt(x.amt)}`).join('；') };
}
function peopleList(list, ctx) {
  return `<div class="list">${list.filter(g => g.open > 0.5).map(g => `<button type="button" class="row" data-act="person" data-n="${esc(g.who)}" data-ctx="${esc(ctx || '')}"><span><span class="t">${esc(g.who)}</span><span class="m"><span>${g.count} 筆</span>${g.open < g.amt - 0.5 ? `<span>已收 ${fmt(g.amt - g.open)}</span>` : ''}</span></span><span class="a">${fmt(g.open)}</span></button>`).join('')}</div>`;
}
function sheetPerson(who, ctx) {
  const filt = r => r.open > 0.5 && (!ctx || r.trip === ctx);
  const g = E.peopleOwe(S.res.receivables, filt).find(x => x.who === who); if (!g) { toast('沒有未收的了'); closeSheet(); return; }
  const items = g.items.filter(i => i.open > 0.5).sort((a, b) => a.recv.date.localeCompare(b.recv.date));
  openSheet(`<h3>${esc(who)} 要還我的</h3><div class="facts"><b class="num">NT$ ${fmt(g.open)}</b><span>${items.length} 筆${ctx ? '・這趟旅行' : ''}</span></div>
    <div class="list">${items.map(i => `<button type="button" class="row" data-act="settle" data-key="${esc(i.recv.key)}" data-w="${esc(who)}"><span><span class="t">${esc(i.recv.desc || '')}</span><span class="m"><span>${i.recv.date}</span>${i.recv.fx ? `<span>整筆 ${esc(i.recv.fx.cur)} ${fmt(i.recv.fx.amt)}</span>` : ''}${i.open < i.amt - 0.5 ? `<span>已收 ${fmt(i.amt - i.open)}</span>` : ''}</span></span><span class="a">${fmt(i.open)}</span></button>`).join('')}</div>
    <div class="sub">點單筆可以選對應的轉帳紀錄。對方一次還清（現金、轉帳或旅費互抵）就按下面的按鈕。</div>
    <div class="acts"><button class="btn primary" data-act="personall" data-n="${esc(who)}" data-ctx="${esc(ctx || '')}">${esc(who)} 全部已收回</button><button class="btn" data-act="closesheet">關閉</button></div>`);
}
function tripPanel() {
  const t = S.config.trip; if (!t) return '';
  const sm = E.tripSummary(S.res.ledger, t); const active = E.tripActive(t, todayISO());
  const cats = Object.entries(sm.by).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(c => Math.abs(c[1])));
  const sym = { JPY: '¥', USD: 'US$', KRW: '₩', EUR: '€' }[t.cur] || t.cur;
  return `<section class="panel"><header><h2>✈️ ${esc(t.name || '旅行')}</h2><span style="display:flex;gap:6px;align-items:center">${active ? '<span class="pill ok">旅行中</span>' : t.on ? '<span class="pill mute">已設定</span>' : ''}<button class="btn small" data-act="tripedit">設定</button></span></header>
    <div class="sub">${esc(t.start)} ～ ${esc(t.end)}・匯率 ${t.rate}${active ? '・記一筆會自動用' + esc(sym) + '輸入、算進這趟旅行' : ''}</div>
    ${sm.count ? `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))"><div class="kpi"><span class="lbl">我負擔</span><span class="val">${fmt(sm.mine)}</span><span class="note">台幣</span></div>${sm.others > 0.5 ? `<div class="kpi"><span class="lbl">幫旅伴先付</span><span class="val">${fmt(sm.others)}</span><span class="note">回國後結清</span></div>` : ''}${sm.cashFx || t.cashStart ? `<div class="kpi"><span class="lbl">${t.cashStart ? esc(t.cashAccount || '現金') + '還剩' : '用掉' + esc(t.cashAccount || '現金')}</span><span class="val">${esc(sym)}${fmt(t.cashStart ? t.cashStart - sm.cashFx : sm.cashFx)}</span><span class="note">${t.cashStart ? `帶出門 ${esc(sym)}${fmt(t.cashStart)}・已用 ${esc(sym)}${fmt(sm.cashFx)}` : '含幫旅伴付的'}</span></div>` : ''}</div>
      <div class="cats">${cats.map(([k, v]) => `<div class="cat"><span>${esc(k)}</span><span class="bar"><i style="width:${(Math.abs(v) / max * 100).toFixed(1)}%${v < 0 ? ';background:var(--income)' : ''}"></i></span><span class="amt num">${v < 0 ? '−' + fmt(-v) : fmt(v)}</span></div>`).join('')}</div>
      ${(() => { const ppl = E.peopleOwe(S.res.receivables, r => r.trip === t.id && r.open > 0.5).filter(g => g.open > 0.5); return ppl.length ? `<h3 class="mini">要收的錢</h3>${peopleList(ppl, t.id)}<div class="sub">跟旅伴互相代墊的話（例如對方先付了機票），最後的淨額以分帳表為準。</div>` : ''; })()}
      <button class="linkbtn" data-act="triprows">看全部 ${sm.count} 筆</button>
      <div class="sub">刷卡的會等信用卡帳單出來後自動對上，帳單上的實際台幣跟記帳時的差額會自動補上。</div>` : `<div class="sub">${active ? '旅行中記的每一筆都會出現在這裡。' : '出發後記帳會自動切成外幣、算進這趟旅行。'}${t.cashStart ? `${esc(t.cashAccount || '外幣現金')}帶出門 ${esc(sym)}${fmt(t.cashStart)}。` : ''}</div>`}
  </section>`;
}
function sheetTrip() {
  const t = S.config.trip || { name: '日本', start: todayISO(), end: todayISO(), cur: 'JPY', rate: 0.2041, cashAccount: '日幣現金', on: true };
  openSheet(`<h3>旅行模式</h3><div class="sub">旅行期間記一筆會直接輸入外幣、換成台幣，並算進「娛樂與個人享受・旅遊」，不占日常餐費和加菜額度。</div>
    <form class="form" id="tripform">
      <div class="fields2"><div class="field"><label for="t-name">名稱</label><input id="t-name" name="name" value="${esc(t.name || '')}"></div><div class="field"><label for="t-cur">幣別</label><select id="t-cur" name="cur">${opt([['JPY', '日幣 JPY'], ['USD', '美金 USD'], ['KRW', '韓元 KRW'], ['EUR', '歐元 EUR'], ['TWD', '台幣（國內旅遊）']], t.cur)}</select></div></div>
      <div class="fields2"><div class="field"><label for="t-start">出發</label><input id="t-start" name="start" type="date" value="${esc(t.start)}"></div><div class="field"><label for="t-end">回國</label><input id="t-end" name="end" type="date" value="${esc(t.end)}"></div></div>
      <div class="fields2"><div class="field"><label for="t-rate">匯率（1 外幣＝幾台幣）</label><input id="t-rate" name="rate" inputmode="decimal" value="${t.rate}"></div><div class="field"><label for="t-cash">外幣現金帳戶</label><input id="t-cash" name="cashAccount" value="${esc(t.cashAccount || '')}"></div></div>
      <div class="field"><label for="t-cashstart">帶出門的外幣現金（可留空）</label><input id="t-cashstart" name="cashStart" inputmode="numeric" value="${t.cashStart ?? ''}" placeholder="例如 100000，卡片會顯示還剩多少"></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="on" ${t.on ? 'checked' : ''}> 啟用（出發到回國期間自動切換）</label>
      <p class="sub" style="margin:0">改匯率只影響之後記的；已記的保留當時的匯率。刷卡的最後以信用卡帳單的台幣為準。</p>
    </form>
    <div class="acts"><button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="tripsave">儲存</button></div>`);
}
async function saveTrip() {
  const f = Object.fromEntries(new FormData($('#tripform')));
  const rate = +String(f.rate).replace(/,/g, '');
  if (!f.start || !f.end || f.end < f.start) { toast('回國日期要在出發之後'); return; }
  if (!(rate > 0)) { toast('匯率要大於 0'); return; }
  const old = S.config.trip || {};
  const trip = { ...old, id: old.id || 't' + f.start.replace(/-/g, ''), name: (f.name || '').trim() || '旅行', start: f.start, end: f.end, cur: f.cur, rate: f.cur === 'TWD' ? 1 : rate, cashAccount: (f.cashAccount || '').trim() || null, cashStart: +String(f.cashStart || '').replace(/,/g, '') || null, on: !!f.on };
  try { await S.db.doc('config/main').update({ trip }); closeSheet(); toast('旅行模式已儲存'); } catch (e) { toast('儲存失敗：' + e.message); }
}
function sheetTripRows() {
  const t = S.config.trip; const sm = E.tripSummary(S.res.ledger, t); if (!sm) return;
  const rows = [...sm.rows].sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`<h3>${esc(t.name)} 全部花費</h3><div class="sub">我負擔 NT$ ${fmt(sm.mine)}${sm.others > 0.5 ? `・幫旅伴先付 NT$ ${fmt(sm.others)}` : ''}</div>
    <div class="list">${rows.map(r => `<button type="button" class="row" data-act="editrow" data-key="${esc(r.key)}"><span><span class="t">${esc(r.desc || r.tripCat || r.bill || '')}</span><span class="m"><span>${r.date.slice(5).replace('-', '/')}</span><span class="pill mute">${esc(r.tripCat || r.bill || '')}</span><span>${esc(r.account || '')}</span>${r.fx ? `<span>${esc(r.fx.cur)} ${fmt(r.fx.amt)}</span>` : ''}${r.share != null ? `<span class="pill acc">總額 ${fmt(r.gross)}</span>` : ''}</span></span><span class="a ${r.type === 'Income' ? 'pos' : ''}">${r.type === 'Income' ? '−' : ''}${fmt(r.amount)}</span></button>`).join('')}</div>
    <div class="acts"><button class="btn" data-act="closesheet">關閉</button></div>`);
}
function mealPlanBlock(m) {
  const plan = S.config.mealPlan; const st = E.mealPlanStatus(S.res.ledger, plan, m, todayISO());
  if (!st) return '';
  const r = st.extraCap ? st.extra / st.extraCap : 0, cls = r > 1 ? 'var(--neg)' : r > 0.8 ? 'var(--warn)' : 'var(--income)';
  const cur = st.today != null;
  const dayFrac = st.elapsed / st.dim;
  return `<div class="mealplan"><div class="cats">
      ${cur ? `<div class="cat" style="grid-template-columns:7.5em 1fr 9.5em"><span>今天日常</span><span class="bar"><i style="width:${Math.min(100, st.today / st.daily * 100).toFixed(1)}%;background:${st.today > st.daily ? 'var(--warn)' : 'var(--income)'}"></i></span><span class="amt num">${fmt(st.today)}<span class="sub">／${fmt(st.daily)}</span></span></div>` : ''}
      <button type="button" class="cat linkbtn" style="color:inherit;font-weight:400;grid-template-columns:7.5em 1fr 9.5em" data-act="mealdays"><span>本月加菜</span><span class="bar" style="position:relative"><i style="width:${Math.min(100, r * 100).toFixed(1)}%;background:${cls}"></i>${cur ? `<b style="position:absolute;top:-3px;bottom:-3px;left:${(dayFrac * 100).toFixed(1)}%;width:2px;background:var(--ink-2)"></b>` : ''}</span><span class="amt num">${fmt(st.extra)}<span class="sub">／${fmt(st.extraCap)}</span></span></button></div>
    <div class="sub">日常每天上限 ${fmt(st.daily)}，超過的部分算加菜（${st.overDays} 天）。日常平均每天 ${fmt(Math.round((st.normal + st.allowance) / st.elapsed))}${st.allowance ? `，含${esc(plan.allowanceSub || '青穎餐費')} ${fmt(st.allowance)}` : ''}。</div></div>`;
}
function sheetMealDays() {
  const plan = S.config.mealPlan; const st = E.mealPlanStatus(S.res.ledger, plan, S.month, todayISO()); if (!st) return;
  const days = Object.entries(st.byDay).filter(([, v]) => v > st.daily).sort((a, b) => b[0].localeCompare(a[0]));
  const rowsOf = d => S.res.ledger.filter(r => r.date === d && E.isMealRow(r) && !E.isMealAllowance(r, plan));
  openSheet(`<h3>${mLabel(S.month)} 加菜的日子</h3><div class="sub">當天外食超過 ${fmt(st.daily)} 的部分算加菜。已用 ${fmt(st.extra)}／${fmt(st.extraCap)}。</div>
    <div class="list">${days.map(([d, v]) => `<div class="dayhead"><span>${+d.slice(5, 7)}/${+d.slice(8)}・當天 ${fmt(v)}・加菜 ${fmt(v - st.daily)}</span></div>${rowsOf(d).map(r => `<button type="button" class="row" data-act="editrow" data-key="${esc(r.key)}"><span><span class="t">${esc(r.desc || r.bill || '')}</span><span class="m"><span>${esc(r.sub || '')}</span></span></span><span class="a">${fmt(r.amount)}</span></button>`).join('')}`).join('') || '<div class="sub">這個月還沒有超過日常上限的日子 👍</div>'}</div>
    <div class="acts"><button class="btn" data-act="closesheet">關閉</button></div>`);
}
function budgetPanel(m) {
  const bs = E.budgetStatus(S.res.ledger, S.config.budgets || [], m);
  const cur = m === todayISO().slice(0, 7);
  const dayFrac = cur ? new Date().getDate() / new Date(+m.slice(0, 4), +m.slice(5), 0).getDate() : 1;
  if (!bs.length) return `<section class="panel"><header><h2>每月預算</h2><button class="btn small" data-act="budgetedit">設定預算</button></header>${mealPlanBlock(m)}<div class="sub">替餐飲、娛樂這些變動支出設一個月上限，首頁和記帳時都會顯示還剩多少。</div></section>`;
  return `<section class="panel"><header><h2>${cur ? '本月預算' : mLabel(m) + ' 預算'}</h2><button class="btn small" data-act="budgetedit">編輯</button></header>
    ${mealPlanBlock(m)}
    <div class="cats">${bs.map((b, i) => { const r = b.ratio; const cls = r > 1 ? 'var(--neg)' : r > 0.8 ? 'var(--warn)' : 'var(--income)';
      return `<button type="button" class="cat linkbtn" style="color:inherit;font-weight:400;grid-template-columns:7.5em 1fr 9.5em" data-act="budgetlist" data-i="${i}"><span>${esc(b.name)}</span><span class="bar" style="position:relative"><i style="width:${Math.min(100, r * 100).toFixed(1)}%;background:${cls}"></i>${cur ? `<b style="position:absolute;top:-3px;bottom:-3px;left:${(dayFrac * 100).toFixed(1)}%;width:2px;background:var(--ink-2)" title="今天"></b>` : ''}</span><span class="amt num">${fmt(b.used)}<span class="sub">／${fmt(b.amount)}</span></span></button>`; }).join('')}</div>
    <div class="sub">${cur ? '直線是今天在這個月的位置，長條超過直線代表花得比進度快。' : ''}${bs.some(b => b.ratio > 1) ? ' 紅色＝已超過預算。' : ''}</div></section>`;
}
function budgetHint() {
  if (!Q.main) return '';
  const amt = amtOf$('#q-amt');
  const d = ($('#q-date') || {}).value || todayISO();
  const probe = { type: 'Expense', life: 1, include: 1, main: Q.main, sub: Q.sub, desc: ($('#q-desc') || {}).value || '' };
  const bs = E.budgetStatus(S.res.ledger, S.config.budgets || [], d.slice(0, 7)).filter(b => E.budgetMatch(b, probe));
  const plan = S.config.mealPlan;
  const mp = E.mealPlanProbe(E.mealPlanStatus(S.res.ledger, plan, d.slice(0, 7), todayISO()), plan, { ...probe, date: d, month: d.slice(0, 7), amount: amt, type: 'Expense', dup: 0 });
  const mealPill = !mp ? '' : mp.allowance ? `<span class="pill ok">${esc(plan.allowanceSub || '青穎餐費')}：算日常，不算加菜</span>`
    : `<span class="pill ${mp.after > plan.daily ? 'warn' : 'ok'}">當天日常 ${fmt(mp.after)}／${fmt(plan.daily)}</span>${mp.add > 0 || mp.extraLeft < 0 ? ` <span class="pill ${mp.extraLeft < 0 ? 'bad' : mp.extraLeft < plan.extra * 0.2 ? 'warn' : 'ok'}">加菜 ${mp.add ? '用掉 ' + fmt(mp.add) + '，' : ''}本月剩 ${fmt(mp.extraLeft)}</span>` : ''}`;
  return mealPill + (mealPill && bs.length ? ' ' : '') + bs.map(b => { const left = b.left - amt; return `<span class="pill ${left < 0 ? 'bad' : left < b.amount * 0.2 ? 'warn' : 'ok'}">${esc(b.name)} ${amt ? '記下後' : ''}剩 ${fmt(left)}</span>`; }).join(' ');
}
function sheetBudget() {
  const bs = (S.config.budgets || []).map(b => ({ ...b }));
  const mains = ['', ...E.MAIN_CATS];
  const row = (b, i) => `<div class="panel" style="padding:12px;background:var(--paper)" data-row="${i}">
    <div class="fields2"><div class="field"><label>名稱</label><input name="name" value="${esc(b.name || '')}" placeholder="例如：餐飲"></div><div class="field"><label>每月上限</label><input name="amount" inputmode="numeric" value="${b.amount ?? ''}"></div></div>
    <div class="fields2"><div class="field"><label>主分類</label><select name="main">${mains.map(m => `<option value="${esc(m)}" ${m === (b.main || '') ? 'selected' : ''}>${m || '（不限，用細項／關鍵字）'}</option>`).join('')}</select></div><div class="field"><label>只算這些細項（逗號分隔）</label><input name="subs" value="${esc((b.subs || []).join(','))}"></div></div>
    <div class="fields2"><div class="field"><label>排除細項</label><input name="excludeSubs" value="${esc((b.excludeSubs || []).join(','))}"></div><div class="field"><label>描述關鍵字</label><input name="keywords" value="${esc((b.keywords || []).join(','))}" placeholder="按摩,采耳"></div></div>
    <div style="display:flex;justify-content:flex-end"><button type="button" class="linkbtn" style="color:var(--neg)" data-act="budgetrm" data-i="${i}">刪除這個預算</button></div></div>`;
  const mp = S.config.mealPlan || {};
  openSheet(`<h3>每月預算</h3>
    <div class="panel" style="padding:12px;background:var(--paper)"><b>餐費額度</b><div class="sub">同一天外食合計在「日常上限」以內算日常，超過的部分從「每月加菜」扣。食材不算外食。</div>
      <div class="fields2"><div class="field"><label for="mp-daily">日常每天上限（兩人）</label><input id="mp-daily" inputmode="numeric" value="${mp.daily ?? ''}" placeholder="例如 800；留空＝不用"></div><div class="field"><label for="mp-extra">每月加菜額度</label><input id="mp-extra" inputmode="numeric" value="${mp.extra ?? ''}" placeholder="例如 6000"></div></div>
      <div class="field"><label for="mp-allow">伴侶餐費零用金的細項</label><input id="mp-allow" value="${esc(mp.allowanceSub || '青穎餐費')}"></div></div>
    <div class="sub">同一筆可以同時算進兩個預算，例如「身體保養」也會算進「娛樂」。</div>
    <div id="budgetrows" style="display:grid;gap:10px">${bs.map(row).join('')}</div>
    <button class="btn small" data-act="budgetadd">＋ 新增預算</button>
    <div class="acts"><button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="budgetsave">儲存</button></div>`);
  S.budgetDraft = bs; S.budgetRow = row;
}
function readBudgetRows() {
  const list = s => String(s || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
  return [...document.querySelectorAll('#budgetrows [data-row]')].map(el => {
    const g = n => el.querySelector(`[name="${n}"]`).value;
    const b = { name: g('name').trim(), amount: +String(g('amount')).replace(/,/g, '') || 0, main: g('main') || undefined, subs: list(g('subs')), excludeSubs: list(g('excludeSubs')), keywords: list(g('keywords')) };
    Object.keys(b).forEach(k => (b[k] === undefined || (Array.isArray(b[k]) && !b[k].length)) && delete b[k]); return b;
  }).filter(b => b.name && b.amount > 0);
}
function catBars(s) {
  const entries = Object.entries(s.cats).concat(Object.entries(s.otherCats)).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  if (s.unclassified) entries.push(['未分類', s.unclassified]);
  if (!entries.length) return '<div class="sub">這個月沒有生活消費紀錄。</div>';
  const max = Math.max(...entries.map(e => e[1]), 1);
  return `<div class="cats">${entries.map(([k, v]) => `<button type="button" class="cat linkbtn" style="color:inherit;font-weight:400" data-act="catfilter" data-cat="${esc(k)}"><span>${esc(k)}</span><span class="bar"><i style="width:${Math.max(0, v / max * 100).toFixed(1)}%"></i></span><span class="amt num">${fmt(v)}</span></button>`).join('')}</div>`;
}
function yearSeries(y) {
  return Array.from({ length: 12 }, (_, i) => { const m = `${y}-${String(i + 1).padStart(2, '0')}`; const s = E.monthStats(S.res.ledger, m, S.config.debts || []); return { m, inc: s.income, exp: s.expense, has: s.count > 0 }; });
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v || 1))); for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p; return 10 * p; }
function trendSvg(y) {
  const data = yearSeries(y);
  const W = Math.max(320, Math.min(940, (document.querySelector('#view') || document.body).clientWidth - 34)), H = W < 500 ? 200 : 240, L = 40, R = 6, T = 12, B = 26;
  const top = Math.max(...data.map(d => Math.max(d.inc, d.exp)), 1);
  const p10 = Math.pow(10, Math.floor(Math.log10(top / 4))); const step = [1, 2, 5, 10].map(k => k * p10).find(v => v * 4 >= top) || 10 * p10;
  const nT = Math.ceil(top / step), max = step * nT;
  const x0 = i => L + i * (W - L - R) / 12;
  const bw = (W - L - R) / 12;
  const yv = v => T + (H - T - B) * (1 - Math.max(0, v) / max);
  let g = '';
  for (let k = 0; k <= nT; k++) { const v = step * k, yy = yv(v); g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="var(--f-num)">${wan(v)}</text>`; }
  const bars = data.map((d, i) => {
    const w = Math.max(3, Math.min(14, bw / 2 - 3)), cx = x0(i) + bw / 2;
    const cur = d.m === S.month;
    const r1 = d.has ? `<path d="${barPath(cx - w - 1, yv(d.inc), w, yv(0))}" fill="var(--income)"/>` : '';
    const r2 = d.has ? `<path d="${barPath(cx + 1, yv(d.exp), w, yv(0))}" fill="var(--expense)"/>` : '';
    return `<g>${cur ? `<rect x="${x0(i) + 1}" y="${T}" width="${bw - 2}" height="${H - T - B}" fill="var(--accent-soft)" rx="6"/>` : ''}${r1}${r2}
      <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${cur ? 'var(--accent)' : 'var(--ink-3)'}" font-weight="${cur ? 700 : 400}">${i + 1}月</text>
      <rect x="${x0(i)}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-i="${i}" class="hit"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${y} 年每月收入與生活消費長條圖">${g}${bars}</svg><div class="tip" hidden></div>`;
}
function barPath(x, y, w, base) { const h = base - y; if (h <= 0) return ''; const r = Math.min(4, h, w / 2); return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`; }
function bindChart() {
  const box = $('#trend'); if (!box) return;
  const tip = box.querySelector('.tip'); const data = yearSeries(S.month.slice(0, 4));
  box.querySelectorAll('.hit').forEach(h => {
    const show = () => {
      const d = data[+h.dataset.i]; if (!d.has) { tip.hidden = true; return; }
      const r = h.getBoundingClientRect(), b = box.getBoundingClientRect();
      tip.innerHTML = `<b>${mLabel(d.m)}</b>收入 <span class="num">${fmt(d.inc)}</span><br>生活消費 <span class="num">${fmt(d.exp)}</span><br>結餘 <span class="num">${sgn(d.inc - d.exp)}</span>`;
      tip.style.left = Math.min(Math.max(r.left - b.left + r.width / 2, 80), b.width - 80) + 'px'; tip.style.top = (r.top - b.top + 8) + 'px'; tip.hidden = false;
    };
    h.addEventListener('mouseenter', show); h.addEventListener('mouseleave', () => tip.hidden = true);
    h.addEventListener('click', () => { const d = data[+h.dataset.i]; if (d.has) { S.month = d.m; render(); } });
  });
}

// ---------------------------------------------------------------- FLOW
function viewFlow() {
  const y = S.flowYear || S.month.slice(0, 4);
  const years = [...new Set(monthsAvailable().map(m => m.slice(0, 4)))];
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const st = months.map(m => E.monthStats(S.res.ledger, m, S.config.debts || []));
  const has = st.map(s => s.count > 0);
  const nHas = has.filter(Boolean).length || 1;
  const row = (label, f, cls = '', fmtf = fmt) => {
    const vals = st.map((s, i) => has[i] ? f(s) : null);
    const ytd = vals.reduce((a, v) => a + (v || 0), 0);
    return `<tr class="${cls}"><td>${label}</td>${vals.map((v, i) => `<td class="num ${months[i] === S.month ? 'cur' : ''} ${v === 0 || v == null ? 'z' : ''}">${v == null ? '' : fmtf(v)}</td>`).join('')}<td class="num">${fmtf === pct ? '' : fmtf(ytd)}</td><td class="num">${fmtf === pct ? '' : fmtf(ytd / nHas)}</td></tr>`;
  };
  const cats = E.MAIN_CATS;
  const lastActual = (() => { const cur = todayISO().slice(0, 7); const ms = monthsAvailable().filter(m => m < cur && m.startsWith(y)); return ms[ms.length - 1] || `${y}-12`; })();
  const pj = S.config.projection || {};
  const P = E.projectYear(S.res.ledger, S.config.debts || [], y, lastActual, { bonus: pj.bonus, monthlyIncome: pj.monthlyIncome });
  const rec = E.recurring(S.res.ledger, lastActual, S.config.debts || []);
  const recTotal = rec.reduce((a, x) => a + x.avg, 0);
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><h1 class="view">${y} 年收支</h1>
    <div class="chips">${years.map(yy => `<button class="chip" data-act="flowyear" data-y="${yy}" aria-pressed="${yy === y}">${yy}</button>`).join('')}</div></div>
  <div class="grid2">
  <section class="panel"><header><h2>年度預估</h2><span class="pill ${P.surplus >= 0 ? 'ok' : 'bad'}">年底 ${sgn(Math.round(P.surplus))}</span></header>
    <div class="nwgrid" style="grid-template-columns:1fr auto auto;gap:6px 14px">
      <span class="sub"></span><span class="sub" style="text-align:right">已發生（${P.actualMonths} 個月）</span><span class="sub" style="text-align:right">預估（${P.restMonths} 個月）</span>
      <span>收入</span><span class="num" style="text-align:right">${fmt(P.act.income)}</span><span class="num" style="text-align:right">${fmt(Math.round(P.fc.income))}</span>
      <span>生活消費</span><span class="num" style="text-align:right">${fmt(Math.round(P.act.expense))}</span><span class="num" style="text-align:right">${fmt(Math.round(P.fc.expense))}</span>
      <span>貸款分期</span><span class="num" style="text-align:right">${fmt(Math.round(P.act.debt))}</span><span class="num" style="text-align:right">${fmt(Math.round(P.fc.debt))}</span>
      <b>結餘</b><b class="num" style="text-align:right">${sgn(Math.round(P.act.income - P.act.expense - P.act.debt))}</b><b class="num" style="text-align:right">${sgn(Math.round(P.fc.income - P.fc.expense - P.fc.debt))}</b>
    </div>
    <div class="sub">全年儲蓄率約 <b>${pct(P.rate)}</b>。預估月份用：每月固定收入 ${fmt(P.regInc)}${P.regIncAuto ? '（近 3 個月最低的一個月，保守估）' : '（你設定的）'}、生活消費 ${fmt(Math.round(P.exp))}（近 6 個月中位數），再加上你填的今年還會入帳的獎金。</div>
    <form class="fields2" id="pjform"><div class="field"><label for="pj-bonus">今年還會入帳的獎金／分紅</label><input id="pj-bonus" name="bonus" inputmode="numeric" value="${pj.bonus ?? ''}" placeholder="0"></div><div class="field"><label for="pj-inc">每月固定收入（留空自動）</label><input id="pj-inc" name="monthlyIncome" inputmode="numeric" value="${pj.monthlyIncome ?? ''}" placeholder="${fmt(P.regInc)}"></div></form>
    <div style="display:flex;justify-content:flex-end"><button class="btn small" data-act="pjsave">更新預估</button></div>
  </section>
  <section class="panel"><header><h2>每月固定／週期性支出</h2><span class="sub num">約 ${fmt(recTotal)}／月</span></header>
    <div class="list">${rec.map(x => `<div class="row" style="cursor:default"><span><span class="t">${esc(x.desc || x.sub || x.main)}</span><span class="m"><span class="pill ${x.loan ? 'acc' : x.fixed === '固定' ? 'mute' : 'warn'}">${x.loan ? '貸款' : x.fixed === '固定' ? '固定' : '常態'}</span><span>${esc(x.main || '')}${x.sub ? '・' + esc(x.sub) : ''}</span><span>近 4 個月出現 ${x.months} 次</span></span></span><span class="a">${fmt(x.avg)}</span></div>`).join('') || '<div class="sub">資料還不夠，至少需要 2～3 個月。</div>'}</div>
    <div class="sub">自動從最近 4 個月找出「標成固定」或「每月金額差不多」的支出，金額是出現月份的中位數（避免某個月一次繳兩期被放大）。</div>
  </section>
  </div>
  <div class="tablebox"><table class="ledger">
    <thead><tr><th>項目</th>${months.map(m => `<th class="${m === S.month ? 'cur' : ''}"><button class="linkbtn" style="color:inherit" data-act="setmonth" data-m="${m}">${+m.slice(5)}月</button></th>`).join('')}<th>YTD</th><th>月平均</th></tr></thead>
    <tbody>
      ${row('收入', s => s.income, 'total')}
      ${row('生活消費', s => s.expense, 'total')}
      ${cats.map(c => row('　' + c, s => s.cats[c])).join('')}
      ${row('　其他（手續費、現金差額）', s => Object.values(s.otherCats).reduce((a, v) => a + v, 0))}
      ${row('　未分類', s => s.unclassified)}
      ${row('生活結餘', s => s.balance, 'total sep', v => sgn(v))}
      ${row('儲蓄率', s => s.savingsRate, '', pct)}
      ${row('必要支出', s => s.essential, 'sep')}
      ${row('非必要支出', s => s.nonEssential)}
      ${row('固定支出', s => s.fixed)}
      ${row('變動支出', s => s.variable)}
      ${row('分期／貸款月付', s => Math.round(s.debtCash), 'sep')}
      ${row('扣債務後可自由配置', s => Math.round(s.free), 'total', v => sgn(v))}
      ${row('分紅／獎金', s => s.oneOffIncome, 'sep')}
      ${row('投資資金淨流', s => s.investFlow)}
    </tbody></table></div>
  <p class="sub">生活消費以消費發生日認列；繳卡費、自有帳戶互轉不算支出；投資買賣不算生活支出。點月份可切換報表月份。</p>`;
}

// ---------------------------------------------------------------- RECON
function viewRecon() {
  const m = S.month, r = S.res, st = monthState(m);
  const pend = r.bank.filter(b => b.type === 'Pending' && b.dup === 0 && b.date >= (S.config.bankStart || '2026-08-01')).sort((a, b) => b.date.localeCompare(a.date));
  const hist = r.bank.filter(b => b.type === 'Pending' && b.dup === 0 && b.date < (S.config.bankStart || '2026-08-01'));
  const rc = st.rc;
  const sug = rc.filter(x => x.status === '需人工確認');
  const appOnly = rc.filter(x => x.status === 'APP有卡無');
  const cardOnly = rc.filter(x => x.status === '卡有APP無');
  const matched = rc.filter(x => x.status === '成功配對').length;
  const ignored = rc.filter(x => x.status === '已忽略').length;
  const autoDone = ['手續費入帳', '點數折抵', '帳單期間外', '分期後續期', '待下期帳單'].map(k => [k, rc.filter(x => x.status === k)]).filter(([, v]) => v.length);
  const recv = r.receivables.filter(x => x.open > 0.5).sort((a, b) => a.date.localeCompare(b.date));
  const bexp = r.bank.filter(b => b.expMatch === '需人工確認' && b.date.slice(0, 7) === m);
  const appIss = r.issues.filter(i => ['APP資料異常', '未分類帳本', '設定錯誤', '未分類明細'].includes(i.type) && i.month === m);
  const bankRow = b => `<button type="button" class="row" data-act="editbank" data-key="${esc(b.key)}"><span><span class="t">${esc(b.desc)} ${esc(b.cp || b.note || '')}</span><span class="m"><span>${b.date}</span><span>${esc(b.account)}${b.acctNo ? '・' + esc(b.acctNo.slice(-4)) : ''}</span>${b.msg ? `<span>留言：${esc(b.msg)}</span>` : ''}</span></span><span class="a ${b.amount > 0 ? 'pos' : ''}">${sgn(b.amount)}</span></button>`;
  const side = (k, o, isCard) => o ? `<div class="side"><span class="k">${k}</span><span>${esc(isCard ? o.merchant : (o.desc || o.bill || ''))}</span><span class="sub num">${o.date}・${fmt(o.amount)}${isCard ? '' : '・' + esc(o.bill || '')}</span></div>` : `<div class="side"><span class="k">${k}</span><span class="sub">（沒有對應）</span></div>`;
  return `<h1 class="view">${mLabel(m)} 對帳</h1>
  ${auditSection(m)}
  ${einvSection(m)}
  <section class="panel"><header><h2>銀行待分類</h2><span class="pill ${pend.length ? 'bad' : 'ok'}">${pend.length ? pend.length + ' 筆，會擋月結' : '全部已分類'}</span></header>
    ${pend.length ? `<div class="list">${pend.map(bankRow).join('')}</div>` : '<div class="sub">銀行明細都已經有分類規則。</div>'}
    ${hist.length ? `<details><summary>BANK 啟用前的歷史待分類（${hist.length} 筆，不影響報表）</summary><div class="list">${hist.map(bankRow).join('')}</div></details>` : ''}
  </section>
  <section class="panel"><header><h2>信用卡對帳</h2><span class="sub">成功 ${matched} 筆${ignored ? `・已忽略 ${ignored}` : ''}</span></header>
    ${!st.card ? `<div class="callout">還沒有 ${mLabel(m)} 的玉山信用卡帳單。帳單寄來後到「匯入」選擇 xlsx 檔。</div>` : ''}
    ${autoDone.length ? `<details><summary>系統自動處理：${autoDone.map(([k, v]) => `${k} ${v.length}`).join('・')}</summary><div class="list">${autoDone.flatMap(([k, v]) => v.map(x => `<div class="row" style="cursor:default"><span><span class="t">${esc(x.card ? x.card.merchant : (x.app.desc || x.app.bill))}</span><span class="m"><span class="pill mute">${k}</span><span>${(x.card || x.app).date}</span></span></span><span class="a">${fmt((x.card || x.app).amount)}</span></div>`)).join('')}</div><div class="sub">手續費會自動算進生活消費（金融手續費）；點數折抵的消費淨額是 0；帳單期間外是不在任何一期帳單範圍內的 APP 紀錄；分期付款在第一期就以總額配對，之後各期不再重複算；待下期帳單是比最新一期帳單還晚的刷卡，等下個月帳單匯入後才會配對。</div></details>` : ''}
    ${sug.length ? `<div><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><b>金額相同但有多個候選（${sug.length}）</b><button class="btn small primary" data-act="pairall">全部確認</button></div><div class="sub">系統依日期最接近先幫你配好，確認就好。</div>
      ${sug.map(x => `<div class="pair">${side('APP', x.app)}${side('信用卡', x.card, true)}<div class="acts"><button class="btn small primary" data-act="pairok" data-a="${esc(x.app.key)}" data-c="${esc(x.card.key)}">確認是同一筆</button><button class="btn small" data-act="pairpick" data-side="app" data-key="${esc(x.app.key)}">改配其他筆</button></div></div>`).join('')}</div>` : ''}
    ${appOnly.length ? `<div><b>APP 有、信用卡沒有（${appOnly.length}）</b><div class="sub">可能是金額記錯、記錯帳戶，或是上一期帳單的消費。</div>
      ${appOnly.map(x => `<div class="pair">${side('APP', x.app)}<div class="side" style="align-content:center;display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-act="pairpick" data-side="app" data-key="${esc(x.app.key)}">找對應的刷卡</button><button class="btn small" data-act="editrow" data-key="${esc(x.app.key)}">改帳戶</button></div></div>`).join('')}</div>` : ''}
    ${cardOnly.length ? `<div><b>信用卡有、APP 沒有（${cardOnly.length}）</b><div class="sub">漏記的消費請到「明細」補記；手續費、折抵可直接忽略。</div>
      ${cardOnly.map(x => `<div class="pair">${side('信用卡', x.card, true)}<div class="side" style="align-content:center;display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-act="pairpick" data-side="card" data-key="${esc(x.card.key)}">找 APP 紀錄</button><button class="btn small" data-act="cardadd" data-key="${esc(x.card.key)}">補記</button><button class="btn small" data-act="ignore" data-key="${esc(x.card.key)}">忽略</button></div></div>`).join('')}</div>` : ''}
    ${st.card && !sug.length && !appOnly.length && !cardOnly.length ? '<div class="sub">這個月的信用卡都對上了。</div>' : ''}
    ${(() => { const man = rc.filter(x => x.status === '成功配對' && ['人工確認', '多筆合併'].includes(x.how)); return man.length ? `<details><summary>你手動配對的（${man.length}），配錯可以取消</summary><div class="list">${man.map(x => { const o = S.ovr.find(v => v.kind === 'cardmatch' && v.cardKey === x.card.key); return `<div class="row" style="cursor:default"><span><span class="t">${esc(x.card.merchant)} ${fmt(x.card.amount)}</span><span class="m">${x.apps.map(a => esc(a.desc || a.bill) + ' ' + fmt(a.gross ?? a.amount)).join(' ＋ ')}${x.amountDiff ? `<span class="pill ${x.adjusted ? 'acc' : 'warn'}">差 ${sgn(x.amountDiff)}${x.adjusted ? ' 已補' : ''}</span>` : ''}</span></span>${o ? `<button class="btn small" data-act="unpair" data-id="${esc(o._id)}">取消配對</button>` : ''}</div>`; }).join('')}</div></details>` : ''; })()}
  </section>
  <section class="panel"><header><h2>代墊款未收回</h2><span class="pill ${recv.length ? 'warn' : 'ok'}">${recv.length ? '共 ' + fmt(recv.reduce((a, x) => a + x.open, 0)) : '沒有未收回'}</span></header>
    ${recv.length ? `${peopleList(E.peopleOwe(recv), '')}<details><summary>逐筆看（${recv.length} 筆）</summary><div class="list">${recv.map(x => `<button type="button" class="row" data-act="settle" data-key="${esc(x.key)}"><span><span class="t">${esc(x.desc || '')}${x.who ? '・' + esc(x.who) : ''}</span><span class="m"><span>${x.date}</span><span>總額 ${fmt(x.total)}・我負擔 ${fmt(x.share)}</span>${x.paid ? `<span>已收 ${fmt(x.paid)}</span>` : ''}</span></span><span class="a">${fmt(x.open)}</span></button>`).join('')}</div></details><div class="sub">點人名看他欠的每一筆；朋友還錢時點單筆，選對應的入帳紀錄（銀行轉帳或 APP 的代墊款回收）。</div>`
      : '<div class="sub">在明細或補記時填「我負擔金額」，其餘會變成應收代墊款，不算你的消費。</div>'}
  </section>
  ${bexp.length ? `<section class="panel"><header><h2>銀行支出待確認</h2><span class="pill warn">${bexp.length}</span></header><div class="sub">銀行有一筆支出，APP 有多筆同金額的紀錄，系統沒有自動補進總帳。若 APP 已記過就不用處理。</div><div class="list">${bexp.map(bankRow).join('')}</div></section>` : ''}
  ${appIss.length ? `<section class="panel"><header><h2>APP 資料檢查</h2><span class="pill warn">${appIss.length}</span></header><div class="list">${appIss.map(i => `<div class="row" style="cursor:default"><span><span class="t">${esc(i.type)}</span><span class="m">${esc(i.text)}${i.file ? '・' + esc(i.file) : ''}</span></span><span></span></div>`).join('')}</div></section>` : ''}`;
}

// ---------------------------------------------------------------- LIST
function viewList() {
  const m = S.month, q = S.q.trim().toLowerCase();
  let rows = S.res.ledger.filter(r => r.month === m);
  const F = { all: () => true, life: r => r.type === 'Expense' && r.life === 1, income: r => r.type === 'Income', other: r => !(r.type === 'Expense' && r.life === 1) && r.type !== 'Income' };
  if (S.filter.startsWith('budget:')) { const b = (S.config.budgets || []).filter(x => +x.amount > 0)[+S.filter.slice(7)]; rows = b ? rows.filter(r => E.budgetMatch(b, r)) : rows; }
  else if (S.filter.startsWith('cat:')) { const c = S.filter.slice(4); rows = rows.filter(r => r.type === 'Expense' && r.life === 1 && (c === '未分類' ? !r.main : r.main === c)); }
  else rows = rows.filter(F[S.filter] || F.all);
  if (q) rows = rows.filter(r => [r.desc, r.bill, r.main, r.sub, r.account, r.book, r.store, String(r.amount)].join(' ').toLowerCase().includes(q));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const groups = {}; for (const r of rows) (groups[r.date] ||= []).push(r);
  const total = rows.reduce((s, r) => s + (r.type === 'Expense' && r.life && r.include !== 0 ? r.amount : 0), 0);
  const chips = [['all', '全部'], ['life', '生活消費'], ['income', '收入'], ['other', '轉帳・投資・負債']];
  const wd = d => '日一二三四五六'[new Date(d + 'T00:00:00').getDay()];
  const withPhoto = new Set(S.manual.filter(x => x.photo).map(x => x.id || x._id));
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><h1 class="view">${mLabel(m)} 明細</h1><button class="btn primary" data-act="addmanual">＋ 記一筆</button></div>
  <div class="toolbar"><input class="search" id="list-search" type="search" placeholder="搜尋描述、分類、金額" value="${esc(S.q)}" aria-label="搜尋明細">
    <div class="chips">${chips.map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}${S.filter.startsWith('cat:') ? `<button class="chip" aria-pressed="true" data-act="filter" data-f="all">${esc(S.filter.slice(4))} ✕</button>` : ''}${S.filter.startsWith('budget:') ? `<button class="chip" aria-pressed="true" data-act="filter" data-f="all">預算：${esc(((S.config.budgets || []).filter(x => +x.amount > 0)[+S.filter.slice(7)] || {}).name || '')} ✕</button>` : ''}</div></div>
  <section class="panel" style="padding-top:4px"><div class="sub" style="padding-top:10px">${rows.length} 筆・其中生活消費 <span class="num">${fmt(total)}</span></div>
  <div class="list">${Object.entries(groups).map(([d, rs]) => `<div class="dayhead"><span>${+d.slice(5, 7)}/${+d.slice(8)}（${wd(d)}）</span></div>${rs.map(r => {
    const isLife = r.type === 'Expense' && r.life === 1;
    return `<div class="swipe">${r.type === 'Expense' ? `<div class="swipe-acts"><button type="button" class="swipe-btn" data-act="copyrow" data-key="${esc(r.key)}" tabindex="-1">複製</button></div>` : ''}<button type="button" class="row swipe-fg" data-act="editrow" data-key="${esc(r.key)}"><span><span class="t">${esc(r.desc || r.bill || r.main || '')}</span><span class="m">${r.main ? `<span class="pill ${isLife ? 'mute' : 'acc'}">${esc(r.main)}${r.sub ? '・' + esc(r.sub) : ''}</span>` : `<span class="pill ${isLife ? 'warn' : 'mute'}">${isLife ? '未分類' : TYPE_ZH[r.type] || r.type}</span>`}${!isLife && r.main ? `<span>${TYPE_ZH[r.type] || r.type}</span>` : ''}<span>${esc(r.account || '')}</span>${r.src !== 'APP' ? `<span>${r.src === 'BANK' ? '銀行' : '手動'}</span>` : ''}${r.excluded ? `<span class="pill mute">${esc(r.excluded)}・不計入</span>` : ''}${r.store ? `<span>🏪 ${esc(r.store)}</span>` : ''}${r.src === 'MANUAL' && withPhoto.has(r.manualId) ? '<span title="有收據照片">📷</span>' : ''}${r.receipt === 'paper' ? '<span class="pill mute" title="紙本發票，記得留著對獎">紙本發票</span>' : ''}${r.share != null ? `<span class="pill acc">代墊・總額 ${fmt(r.gross)}</span>` : ''}${r.src === 'PAYROLL' ? '<span>薪資扣款加回</span>' : ''}${r.edited ? '<span>已修改</span>' : ''}</span></span><span class="a ${r.type === 'Income' ? 'pos' : ''}">${r.type === 'Income' ? '+' : ''}${fmt(r.amount)}</span></button></div>`;
  }).join('')}`).join('') || '<div class="empty sub">沒有符合的紀錄。</div>'}</div>
  <div class="sub" style="padding-top:8px">手機上：紀錄往左滑可以「複製」成今天的一筆；整頁左右滑可以切換分頁。</div></section>`;
}

// ---------------------------------------------------------------- ASSETS
const NW_FIELDS = [
  ['h', '現金與存款'], ['兆豐', '兆豐（薪轉＋數位帳戶）'], ['玉山', '玉山存款'], ['現金', '現金'], ['還款專戶-將來', '還款專戶（將來）'], ['緊急預備金', '緊急預備金／定存'], ['應收代墊款', '應收代墊款（朋友還沒還）'],
  ['h', '投資（月底市值）'], ['長期投資', '長期投資'], ['波段投資', '波段投資'],
  ['h', '負債（填正數，自動算成負值）'], ['信貸', '信貸剩餘本金'], ['信用卡未繳', '信用卡未繳'], ['0%分期', '0% 分期未到期'],
];
const LIAB = ['信貸', '信用卡未繳', '0%分期'];
function nwTotals(n) {
  let assets = 0, liab = 0;
  for (const [k] of NW_FIELDS) { if (k === 'h' || n[k] == null || n[k] === '') continue; const v = +n[k]; if (LIAB.includes(k)) liab += Math.abs(v); else assets += v; }
  return { assets, liab, net: assets - liab };
}
function nwSuggest(m) {
  const bal = E.balances(S.raw, m), inv = E.latestInvest(S.raw), stmt = E.cardStatement(S.raw, m);
  const debts = (S.config.debts || []).map(d => ({ d, s: E.debtStatus(d, m) }));
  const sum = t => debts.filter(x => x.d.type === t).reduce((a, x) => a + x.s.balance, 0);
  const lt = inv ? inv.holdings.filter(h => h.account === '長期').reduce((a, h) => a + h.mvTwd, 0) : null;
  const sw = inv ? inv.holdings.filter(h => h.account !== '長期').reduce((a, h) => a + h.mvTwd, 0) + inv.external.reduce((a, h) => a + h.mvTwd, 0) : null;
  return {
    兆豐: bal['兆豐'] ? bal['兆豐'].total : null, 玉山: bal['玉山'] ? bal['玉山'].total : null, 長期投資: lt == null ? null : Math.round(lt), 波段投資: sw == null ? null : Math.round(sw),
    信貸: sum('信貸') || null, '0%分期': sum('0%分期') || null, 信用卡未繳: stmt ? stmt.statementTotal : null,
    應收代墊款: Math.round(S.res.receivables.filter(x => x.date <= m + '-31').reduce((a, x) => a + x.amount - x.settlements.filter(st => true).reduce((t, st) => t + (+st.amount || 0), 0), 0)) || null,
    _hint: { 兆豐: bal['兆豐'] ? bal['兆豐'].parts.map(p => `…${p.acctNo.slice(-4)} ${fmt(p.bal)}（${p.date}）`).join('＋') : '', 玉山: bal['玉山'] ? `最後餘額 ${bal['玉山'].parts[0].date}` : '',
      長期投資: inv ? `${esc(String(inv.file).replace(/（.*$/, ''))} ${String(inv.asOf || '').slice(0, 10)} 市值` : '', 波段投資: inv ? `含 Binance ${fmt(inv.external.reduce((a, h) => a + h.mvTwd, 0))}；券商交割現金在兆豐數位帳戶，不重複計` : '',
      信貸: '依利率與已繳期數推算', 應收代墊款: '依明細裡填的代墊金額扣掉已收回', '0%分期': '依分期表推算', 信用卡未繳: stmt ? `${stmt.file} 本期應繳` : '' },
  };
}
function viewAssets() {
  const m = S.month, n = S.nw[m] || {}, sug = nwSuggest(m), t = nwTotals(n);
  const inv = E.latestInvest(S.raw);
  const debts = S.config.debts || [];
  const hist = Object.values(S.nw).filter(x => x._id <= m).sort((a, b) => a._id.localeCompare(b._id));
  const em = E.emergencyMonths(S.res.ledger, S.nw, m, S.config.debts || []);
  const cc = E.cashCheck(S.res, S.nw, m, '現金');
  return `<h1 class="view">${mLabel(m)} 資產負債</h1>
  <div class="kpis">
    <div class="kpi"><span class="lbl">總資產</span><span class="val">${fmt(t.assets)}</span></div>
    <div class="kpi"><span class="lbl">總負債</span><span class="val negv">${fmt(-t.liab)}</span></div>
    <div class="kpi"><span class="lbl">Net Worth</span><span class="val ${t.net < 0 ? 'negv' : ''}">${fmt(t.net)}</span><span class="note">${S.nw[m] ? esc(n.status || '暫估') : '尚未填寫'}</span></div>
    <div class="kpi"><span class="lbl">緊急預備金可撐</span><span class="val ${em.months != null && em.months < 3 ? 'negv' : ''}">${em.months == null ? '—' : em.months.toFixed(1) + ' 個月'}</span><span class="note">${em.need ? `(預備金 ${fmt(em.reserve)}＋還款專戶 ${fmt(em.loanReserve)}) ÷ 每月必要開銷 ${fmt(em.need)}（生活必要 ${fmt(em.avgEssential)}＋貸款分期 ${fmt(em.debt)}）${em.months != null && em.months < 3 ? '・建議至少 3～6 個月' : ''}` : '需要必要支出資料'}</span></div>
  </div>
  <div class="grid2">
  <section class="panel"><header><h2>月底快照</h2><button class="btn small" data-act="nwfill">帶入建議值</button></header>
    <form class="nwgrid" id="nwform">
      ${NW_FIELDS.map(([k, l]) => k === 'h' ? `<div class="h">${l}</div>` : `<label for="nw-${k}">${l}</label><input id="nw-${k}" name="${k}" inputmode="numeric" value="${n[k] == null ? '' : Math.abs(n[k])}" placeholder="${sug[k] == null ? '' : fmt(sug[k])}">${sug._hint[k] ? `<div class="hint">建議 ${sug[k] == null ? '—' : fmt(sug[k])}：${esc(sug._hint[k])}</div>` : ''}`).join('')}
      <label for="nw-status">狀態</label><select id="nw-status" name="status" style="border:1px solid var(--rule-2);background:var(--paper);border-radius:8px;padding:7px 9px"><option ${n.status !== '已確認' ? 'selected' : ''}>暫估</option><option ${n.status === '已確認' ? 'selected' : ''}>已確認</option></select>
    </form>
    <div class="sheet-acts" style="display:flex;gap:8px;justify-content:flex-end"><button class="btn primary" data-act="nwsave">儲存 ${mLabel(m)} 快照</button></div>
  </section>
  <div style="display:grid;gap:18px;align-content:start">
  <section class="panel"><header><h2>錢包盤點</h2>${cc.ready ? `<span class="pill ${Math.abs(cc.gap) < 300 ? 'ok' : 'warn'}">${Math.abs(cc.gap) < 300 ? '對得上' : '差 ' + fmt(cc.gap)}</span>` : ''}</header>
    <div class="nwgrid" style="grid-template-columns:1fr auto">
      <span>上月底錢包現金</span><span class="num">${cc.opening == null ? '未填' : fmt(cc.opening)}</span>
      <span>＋ 本月從銀行提領</span><span class="num">${fmt(cc.withdrawn)}</span>
      ${cc.cashIn ? `<span>＋ 朋友還的現金</span><span class="num">${fmt(cc.cashIn)}</span>` : ''}
      <span>− 有記到的現金支出（${cc.rows} 筆）</span><span class="num">${fmt(cc.spent)}</span>
      <span>− 本月底錢包現金</span><span class="num">${cc.closing == null ? '未填' : fmt(cc.closing)}</span>
      <b>＝ 沒記到的現金</b><b class="num ${cc.ready && cc.gap > 300 ? 'negv' : ''}">${cc.ready ? fmt(cc.gap) : '—'}</b>
    </div>
    ${!cc.ready ? `<div class="sub">月底數一下錢包，把金額填在快照的「現金」欄並儲存。上個月底和這個月底都有填，就算得出這個月有多少現金沒記到。</div>`
      : cc.gap > 300 ? `<div class="sub">可能是忘了記的小額消費。想不起來的話，可以把差額記成一筆「現金差額」算進消費。</div><div style="display:flex;justify-content:flex-end"><button class="btn small" data-act="cashgap" data-amt="${cc.gap}">把 ${fmt(cc.gap)} 記成現金差額</button></div>`
      : cc.gap < -300 ? '<div class="sub">錢包比預期多：可能有現金收入沒記，或有支出記重複／記錯帳戶。</div>' : '<div class="sub">現金收支對得上 👍</div>'}
  </section>
  <section class="panel"><header><h2>分期與貸款</h2><button class="btn small" data-act="debtedit" data-i="-1">＋ 新增</button></header>
    <div class="list">${debts.map((d, i) => { const s = E.debtStatus(d, m); return `<button type="button" class="row" data-act="debtedit" data-i="${i}"><span><span class="t">${esc(d.name)}</span><span class="m"><span class="pill ${s.status === '進行中' ? 'acc' : 'mute'}">${s.status}</span><span>${esc(d.type || '')}</span><span>月付 ${fmt(Math.round(s.payment || 0))}</span><span>${s.paid}/${d.n || '?'} 期</span></span></span><span class="a">${fmt(s.balance)}</span></button>`; }).join('')}</div>
  </section>
  <section class="panel"><header><h2>投資部位</h2>${stockLedgerLocal() ? '<button class="btn small" data-act="stocksync">從投資總帳同步</button>' : ''}</header>
    <div class="sub">${inv ? `來源：${esc(inv.file)}・行情 ${esc(String(inv.asOf || '').slice(0, 10))}${inv.syncedAt ? '・同步於 ' + esc(inv.syncedAt.slice(0, 16).replace('T', ' ')) : ''}` : '尚未匯入'}${stockLedgerLocal() ? '' : '<br>這台裝置的瀏覽器沒有投資總帳資料；請在有用投資總帳（Stock Claude）的那台裝置打開家計帳簿，會自動同步。'}</div>
    ${inv ? `<div class="list">${inv.holdings.sort((a, b) => b.mvTwd - a.mvTwd).map(h => `<div class="row" style="cursor:default"><span><span class="t">${esc(h.ticker)} <span class="sub">${esc(h.account)}</span></span><span class="m">${fmt(h.qty, 4)} 股・成本 ${fmt(h.costTwd)}</span></span><span class="a">${fmt(h.mvTwd)}<br><span class="sub ${h.mvTwd - h.costTwd < 0 ? 'negv' : 'pos'}">${sgn(h.mvTwd - h.costTwd)}</span></span></div>`).join('')}
      ${inv.external.map(h => `<div class="row" style="cursor:default"><span><span class="t">${esc(h.ticker)} <span class="sub">${esc(h.venue || '')}</span></span><span class="m">${esc(String(h.asOf || '').slice(0, 10))}</span></span><span class="a">${fmt(h.mvTwd)}</span></div>`).join('')}</div>
      ${inv.brokerCashTwd != null ? `<div class="sub">交割戶餘額 ${fmt(inv.brokerCashTwd)}${inv.brokerCashAt ? '（' + esc(String(inv.brokerCashAt).slice(5, 10).replace('-', '/')) + '）' : ''}（已含在兆豐存款，不重複計）</div>` : ''}` : '<div class="sub">到「匯入」選擇投資總帳匯出的 JSON。</div>'}
  </section>
  ${hist.length > 1 ? `<section class="panel"><header><h2>Net Worth 走勢</h2></header><div class="list">${hist.map(x => `<div class="row" style="cursor:default"><span>${mLabel(x._id)} <span class="sub">${esc(x.status || '')}</span></span><span class="a">${fmt(nwTotals(x).net)}</span></div>`).join('')}</div></section>` : ''}
  </div></div>`;
}

// ---------------------------------------------------------------- DATA / IMPORT
function viewData() {
  S.raw = S.raw || [];
  const by = {}; for (const f of S.raw) (by[f.kind] ||= []).push(f);
  const KZ = { app: '記帳 APP', bank: '銀行存款', card: '玉山信用卡', einvoice: '載具發票', invest: '投資 JSON' };
  const imp = S.import;
  const cp = S.ovr.filter(o => o.kind === 'cprule');
  return `<h1 class="view">匯入資料</h1>
  <section class="panel"><header><h2>月底匯入</h2><span class="sub">在電腦上操作</span></header>
    <div class="drop" id="drop">
      <b>選擇 D:\\Finance 資料夾</b>
      <span class="sub">會自動找出 APP_RAW、BANK_RAW、CARD_RAW、EINVOICE_RAW、INVEST_RAW 裡的檔案；沒變的檔案會略過。也可以只挑幾個檔案。</span>
      <div class="toolbar" style="justify-content:center"><label class="btn primary" for="pick-dir">選擇資料夾</label><label class="btn" for="pick-files">選擇檔案</label></div>
      <input id="pick-dir" type="file" webkitdirectory directory multiple hidden><input id="pick-files" type="file" multiple accept=".xlsx,.xls,.json,.csv" hidden>
    </div>
    ${imp ? importPanel(imp) : ''}
    <details><summary>檔名規則</summary><div class="sub" style="padding-top:6px;display:grid;gap:4px">
      <span>記帳 APP：<span class="mono">YYYY-MM_帳本.xlsx</span>（例：2026-10_餐飲.xlsx）</span>
      <span>兆豐：<span class="mono">YYYY-MM_兆豐.xlsx</span> 或 <span class="mono">YYYY-MM_兆豐_薪轉.xlsx</span></span>
      <span>玉山存款：<span class="mono">YYYY-MM_玉山.xlsx</span>，有密碼的檔案要先移除密碼</span>
      <span>玉山信用卡：<span class="mono">YYYY-MM_玉山unicard.xlsx</span>（月份＝帳單月份）</span>
      <span>載具發票：財政部電子發票平台「下載 CSV 檔」的檔案（檔名不限），同月份重新匯入會取代舊的</span>
      <span>投資：投資總帳匯出的 <span class="mono">stock-claude-YYYY-MM-DD.json</span>（舊版 stock-ledger-…json 也可），以最新一份為準</span>
    </div></details>
  </section>
  <section class="panel"><header><h2>已匯入的原始檔</h2><span class="sub">${S.raw.length} 檔</span></header>
    ${Object.entries(KZ).map(([k, l]) => by[k] ? `<details ${k === 'invest' ? 'open' : ''}><summary>${l}（${by[k].length}）</summary><div class="filelist">${by[k].sort((a, b) => b.file.localeCompare(a.file)).map(f => `<div class="f"><span>${esc(f.file)}${f.legacy ? ' <span class="pill mute">V2 舊 PDF</span>' : ''}</span><span class="sub num">${f.rows ? f.rows.length + ' 筆' : f.holdings ? f.holdings.length + ' 檔持股' : ''} <button class="linkbtn" style="color:var(--neg);margin-left:8px" data-act="delraw" data-id="${esc(f._id)}">刪除</button></span></div>`).join('')}</div></details>` : '').join('')}
  </section>
  <section class="panel"><header><h2>同步與備份</h2><span class="pill ${S.syncState === 'synced' ? 'ok' : S.syncState === 'error' ? 'bad' : 'warn'}">${STATUS_ZH[S.syncState] || '—'}</span></header>
    <div class="sub">資料 repo：<span class="mono">${esc((ghSettings() || {}).owner || '')}/${esc((ghSettings() || {}).repo || '')}</span>${S.syncDetail && S.syncState !== 'synced' ? '・' + esc(S.syncDetail) : ''}</div>
    <div class="toolbar"><button class="btn small" data-act="syncnow">立即同步</button><button class="btn small" data-act="backup">下載完整備份 JSON</button><label class="btn small" for="restore-file">從備份還原</label><input id="restore-file" type="file" accept=".json" hidden><button class="btn small danger" data-act="ghlogout">這台裝置登出</button></div>
  </section>
  ${categoryPanel()}
  ${cp.length ? `<section class="panel"><header><h2>你新增的對手方規則</h2></header><div class="list">${cp.map(o => `<div class="row" style="cursor:default"><span><span class="t">${esc(o.name || o.cp)}</span><span class="m mono">${esc(o.cp)}・${TYPE_ZH[o.txType] || o.txType}</span></span><button class="linkbtn" style="color:var(--neg)" data-act="delovr" data-id="${esc(o._id)}">移除</button></div>`).join('')}</div></section>` : ''}`;
}
function categoryPanel() {
  const dm = S.config.detailMap || [];
  const mains = [...new Set([...E.MAIN_CATS, ...dm.map(d => d.main)])].filter(m => !['負債', '融資成本', '歷史調整', '收入', '轉帳', '投資', '投資收入'].includes(m));
  const subsOf = m => { const seen = new Map(); dm.forEach((d, i) => { if (d.main === m && d.sub && !seen.has(d.sub)) seen.set(d.sub, { ...d, i }); }); return [...seen.values()]; };
  return `<section class="panel"><header><h2>分類管理</h2><span class="sub">記帳時可選的細項</span></header>
    <div class="list">${mains.map(m => { const subs = subsOf(m); return `<details><summary>${esc(m)}（${subs.length}）</summary><div class="chips" style="padding:8px 0">${subs.map(d => `<span class="pill ${d.custom ? 'acc' : 'mute'}">${esc(d.sub)}<span class="sub">・${esc(d.essential || '—')}・${esc(d.fixed || '—')}</span>${d.custom ? `<button class="linkbtn" style="color:var(--neg);margin-left:4px" data-act="catdel" data-main="${esc(m)}" data-sub="${esc(d.sub)}" aria-label="刪除 ${esc(d.sub)}">✕</button>` : ''}</span>`).join('') || '<span class="sub">還沒有細項</span>'}</div></details>`; }).join('')}</div>
    <form class="form" id="catform"><div class="fields2"><div class="field"><label for="c-main">主分類</label><select id="c-main" name="main">${mains.map(m => `<option>${esc(m)}</option>`).join('')}</select></div><div class="field"><label for="c-sub">新的細項名稱</label><input id="c-sub" name="sub" placeholder="例如：寵物、咖啡"></div></div>
      <div class="fields2"><div class="field"><label for="c-ess">必要性</label><select id="c-ess" name="essential"><option>非必要</option><option>必要</option></select></div><div class="field"><label for="c-fix">固定／變動</label><select id="c-fix" name="fixed"><option>變動</option><option>固定</option></select></div></div></form>
    <div style="display:flex;justify-content:flex-end"><button class="btn small primary" data-act="catadd">新增細項</button></div>
    <div class="sub">灰色是從舊系統搬來的細項（舊資料還在用，不能刪）；綠色是你新增的。</div>
  </section>`;
}
function importPanel(imp) {
  const counts = imp.items.reduce((a, x) => (a[x.state] = (a[x.state] || 0) + 1, a), {});
  const todo = imp.items.filter(x => x.state === '新增' || x.state === '更新');
  return `<div class="panel" style="background:var(--paper)"><header><h2>${imp.busy ? '處理中…' : '檢查結果'}</h2><span class="sub">${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('・')}</span></header>
    <div class="filelist">${imp.items.filter(x => x.state !== '未變更').map(x => `<div class="f"><span>${esc(x.name)}</span><span class="pill ${x.state === '錯誤' ? 'bad' : x.state === '略過' ? 'mute' : 'acc'}">${x.state}${x.n != null ? '・' + x.n + ' 筆' : ''}</span>${x.err ? `<span class="e">${esc(x.err)}</span>` : ''}</div>`).join('') || '<div class="sub">所有檔案都和帳簿裡的一樣，不用更新。</div>'}</div>
    <div class="toolbar" style="justify-content:flex-end"><button class="btn" data-act="impcancel">取消</button><button class="btn primary" data-act="impgo" ${todo.length && !imp.busy ? '' : 'disabled'}>寫入 ${todo.length} 個檔案</button></div></div>`;
}
let xlsxReady = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return xlsxReady ||= new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('無法載入 Excel 讀取元件')); document.head.appendChild(s); });
}
async function handleFiles(list) {
  const files = [...list];
  S.import = { busy: true, items: [] }; render();
  if (files.some(f => /\.xlsx?$/i.test(f.name))) { try { await loadXLSX(); } catch (e) { toast(e.message); S.import = null; render(); return; } }
  const byId = new Map(S.raw.map(f => [f._id, f]));
  const items = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const kind = E.detectKind(path);
    if (!kind) { if (/\.(xlsx?|json|pdf)$/i.test(file.name) && !/^~\$/.test(file.name)) items.push({ name: file.name, state: '略過', err: /\.pdf$/i.test(file.name) ? 'PDF 帳單已改用 xlsx，舊 PDF 資料已搬進帳簿' : '不在 APP_RAW / BANK_RAW / CARD_RAW / INVEST_RAW / EINVOICE_RAW 資料夾裡，或檔名不符規則' }); continue; }
    try {
      let doc;
      if (kind === 'invest') doc = E.parseInvestAny(file.name, JSON.parse(await file.text()));
      else if (kind === 'einvoice') { const buf = await file.arrayBuffer(); let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { text = new TextDecoder('big5').decode(buf); } doc = E.parseEinvoiceCSV(file.name, text); }
      else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheets = wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })]);
        if (kind === 'app') doc = E.parseApp(file.name, (sheets.find(s => s[0] === 'Sheet1') || sheets[0])[1]);
        else if (kind === 'bank-mega') doc = E.parseBankMega(file.name, sheets);
        else if (kind === 'bank-esun') doc = E.parseBankEsun(file.name, sheets);
        else if (kind === 'card-esun') doc = E.parseCardEsun(file.name, sheets);
      }
      const id = E.fileDocId(doc.kind, doc.kind === 'einvoice' ? doc.file : file.name);
      const body = JSON.stringify(doc.rows || doc.holdings || doc);
      doc.hash = E.util.hash(body) + body.length.toString(36);
      const old = byId.get(id);
      const state = !old ? '新增' : old.hash === doc.hash ? '未變更' : '更新';
      items.push({ name: file.name, id, doc, state, n: doc.rows ? doc.rows.length : null, err: doc.problems && doc.problems.length ? doc.problems.join('；') : null });
    } catch (e) {
      const msg = /password|encrypt|CFB|ECMA-376/i.test(String(e.message)) ? '檔案有密碼保護，請在 Excel 移除密碼後另存再匯入' : e.message;
      items.push({ name: file.name, state: '錯誤', err: msg });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  S.import = { busy: false, items }; render();
}
async function runImport() {
  const todo = S.import.items.filter(x => x.state === '新增' || x.state === '更新');
  S.import.busy = true; render();
  const now = new Date().toISOString();
  const results = await Promise.all(todo.map(x => { x.doc.importedAt = now; return write('raw/' + x.id, x.doc); }));
  const ok = results.filter(Boolean).length;
  S.import = null; toast(`已寫入 ${ok} 個檔案`); render();
}

async function restoreBackup(file) {
  let data; try { data = JSON.parse(await file.text()); } catch (e) { toast('不是有效的 JSON'); return; }
  const docs = data && data.docs; if (!docs || typeof docs !== 'object') { toast('這不是家計帳簿的備份檔'); return; }
  const paths = Object.keys(docs).filter(p => /^(raw|config|ovr|manual|nw)\/[^/]+$/.test(p));
  if (!paths.length) { toast('備份裡沒有資料'); return; }
  const writes = paths.map(p => S.db.doc(p).set(docs[p]));
  toast(`還原 ${paths.length} 筆資料中…`);
  try { await Promise.all(writes); toast(`已還原 ${paths.length} 筆資料`); } catch (e) { toast('還原失敗：' + e.message); }
}

// ---------------------------------------------------------------- SHEETS (edit dialogs)
function openSheet(html) { $('#sheet-root').innerHTML = `<div class="scrim" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; const f = $('#sheet-root .sheet input, #sheet-root .sheet select'); if (f) f.focus({ preventScroll: true }); }
function closeSheet() { $('#sheet-root').innerHTML = ''; }
const opt = (vals, cur) => vals.map(v => Array.isArray(v) ? `<option value="${esc(v[0])}" ${v[0] === cur ? 'selected' : ''}>${esc(v[1])}</option>` : `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
function mainOptions() {
  const s = new Set(E.MAIN_CATS); for (const d of S.config.detailMap || []) s.add(d.main); ['負債', '融資成本', '歷史調整', '收入', '轉帳', '投資', '投資收入'].forEach(x => s.add(x)); return [...s];
}
function subOptions(main) { return [...new Set((S.config.detailMap || []).filter(d => d.main === main).map(d => d.sub))]; }
function accountOptions(cur) {
  const n = new Map(); for (const a of S.res.app) if (a.account && a.src === 'APP') n.set(a.account, (n.get(a.account) || 0) + 1);
  const list = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  for (const x of [S.config.cardAccount || '玉山 unicard', '現金', ...(S.config.payrollAccounts || ['薪資扣款'])]) if (!list.includes(x)) list.push(x);
  if (cur && !list.includes(cur)) list.unshift(cur);
  return list;
}
function accountField(id, name, cur, label) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}" data-other="${id}-other">${accountOptions(cur).map(a => `<option ${a === cur ? 'selected' : ''}>${esc(a)}</option>`).join('')}<option value="__other">其他（自己輸入）…</option></select><input id="${id}-other" name="${name}Other" placeholder="輸入帳戶名稱" hidden></div>`;
}
const TX = [['Expense', '支出'], ['Income', '收入'], ['Transfer', '轉帳（自己的錢換位置）'], ['Investment', '投資'], ['Debt', '負債（借款／還本金）'], ['Adjustment', '調整']];

function sheetEditRow(key) {
  const r = S.res.ledger.find(x => x.key === key) || S.res.app.find(x => x.key === key);
  if (!r) return;
  if (r.src === 'BANK' && r.type !== 'Expense') return sheetEditBank(key);
  if (['PAYROLL', 'CARD'].includes(r.src)) { toast(r.src === 'PAYROLL' ? '這筆是薪資扣款自動加回的收入，改原本那筆支出就好' : '這筆是信用卡帳單自動入帳的'); return; }
  const o = S.ovr.find(x => x.kind === 'app' && x.key === key);
  const isManual = r.src === 'MANUAL';
  openSheet(`<h3>${isManual ? '編輯手動紀錄' : '修改分類'}</h3>
    <div class="facts"><span><b>${esc(r.desc || r.bill || '')}</b></span><span class="num">${r.date}・${fmt(r.gross ?? r.amount)}${r.share != null ? `（我負擔 ${fmt(r.share)}）` : ''}・${esc(r.account || '')}</span><span class="sub">來源：${r.src === 'APP' ? 'APP ' + esc(r.file) + '・帳單「' + esc(r.bill || '') + '」' : r.src === 'BANK' ? '銀行明細（APP 沒有記的支出）' : '手動新增'}</span></div>
    <form class="form" id="rowform">
      ${isManual ? `<div class="fields2"><div class="field"><label for="f-date">日期</label><input id="f-date" name="date" type="date" value="${r.date}"></div><div class="field"><label for="f-amt">總金額</label><input id="f-amt" name="amount" inputmode="decimal" value="${r.gross ?? r.amount}"></div></div><div class="field"><label for="f-desc">描述</label><input id="f-desc" name="desc" value="${esc(r.desc || '')}"></div>${accountField('f-acct', 'account', r.account || '', '付款帳戶')}${receiptField('f-rcpt', r.receipt)}` : ''}
      ${!isManual && r.src === 'APP' ? accountField('f-acct', 'account', r.account || '', '付款帳戶') : ''}
      ${isManual ? manualPhotoBlock(manualById(r.manualId)) : ''}
      ${S.config.trip && ['APP', 'MANUAL'].includes(r.src) && r.type === 'Expense' ? `<div class="fields2"><div class="field"><label for="f-trip">算進旅行</label><select id="f-trip" name="trip">${opt([['', '（不算）'], [S.config.trip.id, '✈️ ' + (S.config.trip.name || '旅行')]], r.trip || '')}</select></div><div class="field"><label for="f-tcat">旅行類別</label><select id="f-tcat" name="tripCat">${opt([['', '—'], ...E.TRIP_CATS.map(c => [c, c])], r.tripCat || '')}</select></div></div>` : ''}
      <div class="fields2"><div class="field"><label for="f-type">交易類型</label><select id="f-type" name="txType" ${r.src === 'BANK' ? 'disabled' : ''}>${opt(TX, r.type)}</select></div>
      <div class="field"><label for="f-life">算生活消費</label><select id="f-life" name="life">${opt([['1', '是'], ['0', '否']], String(r.life))}</select></div></div>
      <div class="fields2"><div class="field"><label for="f-main">主分類</label><select id="f-main" name="main"><option value="">（未分類）</option>${opt(mainOptions(), r.main || '')}</select></div>
      <div class="field"><label for="f-sub">次分類</label><input id="f-sub" name="sub" list="sublist" value="${esc(r.sub || '')}"><datalist id="sublist">${subOptions(r.main).map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
      <div class="fields2"><div class="field"><label for="f-share">我負擔金額${r.fx ? '（台幣）' : '（代墊時填）'}</label><input id="f-share" name="myShare" inputmode="decimal" value="${r.share ?? ''}" placeholder="全部是我的就留空"></div></div>
      ${whoEditor('f-who', rowPeople(r))}${r.fx ? '<div class="sub" style="margin-top:-6px">金額前面加 ¥ 就會用這筆的匯率換成台幣，例如 ¥4500。</div>' : ''}
      <div class="chips" data-gross="${r.gross ?? r.amount}">${[['1/2', .5], ['1/3', 1 / 3], ['1/4', .25], ['2/4', .5], ['2/3', 2 / 3]].map(([l, f]) => `<button type="button" class="chip" data-act="sharefrac" data-f="${f}">我出 ${l}</button>`).join('')}</div>
      <div class="fields2"><div class="field"><label for="f-ess">必要性</label><select id="f-ess" name="essential">${opt([['', '—'], ['必要', '必要'], ['非必要', '非必要']], r.essential || '')}</select></div>
      <div class="field"><label for="f-fix">固定／變動</label><select id="f-fix" name="fixed">${opt([['', '—'], ['固定', '固定'], ['變動', '變動']], r.fixed || '')}</select></div></div>
    </form>
    ${r.src === 'APP' && r.excluded ? `<div class="callout">這筆已標記為「${esc(r.excluded)}」，不計入收支和預算。</div>` : ''}
    <div class="acts">${r.type === 'Expense' ? `<button class="btn" data-act="copyrow" data-key="${esc(key)}">複製成今天</button>` : ''}${r.src === 'APP' ? `<button class="btn" data-act="toggledup" data-key="${esc(key)}">${r.excluded ? '取消重複標記' : '標記為重複'}</button>` : ''}${isManual ? `<button class="btn danger" data-act="delmanual" data-id="${esc(r.manualId)}">刪除</button>` : o ? `<button class="btn" data-act="resetrow" data-id="${esc(o._id)}">還原成規則分類</button>` : ''}<button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="saverow" data-key="${esc(key)}">儲存</button></div>`);
  if (isManual) bindManualPhoto(r.manualId);
  $('#f-main').addEventListener('change', e => { $('#sublist').innerHTML = subOptions(e.target.value).map(s => `<option value="${esc(s)}">`).join(''); const d = (S.config.detailMap || []).find(x => x.main === e.target.value); if (d && !$('#f-ess').value) $('#f-ess').value = d.essential || ''; });
}
function receiptField(id, cur) {
  return `<div class="field"><label for="${id}">發票</label><select id="${id}" name="receipt">${opt([['', '（沒標）'], ...E.RECEIPTS.map(k => [k, RECEIPT_ZH[k] + '・' + RECEIPT_TIP[k]])], cur || '')}</select></div>`;
}
function manualPhotoBlock(m) {
  if (!m) return '';
  const inv = m.inv ? { inv: m.inv, date: m.date, amount: +m.amount, seller: m.seller || '', items: (m.items || []).map(([name, qty, price]) => ({ name, qty, price })) } : null;
  return `<div class="field"><label>收據照片</label><div class="qphoto-card" id="f-photo-card">${m.photo ? `<img id="f-photo" alt="收據照片" data-act="viewphoto" data-path="${esc(m.photo)}">` : '<div class="qphoto-empty sub">還沒有照片</div>'}
    <div class="qphoto-info">${inv ? invoiceSummary(inv, { selfId: m.id }) : ''}<span><label class="linkbtn" for="f-photo-in">${m.photo ? '換一張' : '＋ 加照片'}</label><input id="f-photo-in" type="file" accept="image/*" hidden></span><span id="f-photo-msg" class="sub"></span></div></div></div>`;
}
function bindManualPhoto(id) {
  const m = manualById(id); if (!m) return;
  const img = $('#f-photo');
  if (img && m.photo) S.db.photoUrl(m.photo).then(u => { img.src = u; }).catch(e => { $('#f-photo-msg').textContent = e.message; img.remove(); });
  $('#f-photo-in').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const msg = $('#f-photo-msg'); msg.textContent = '處理中…';
    try {
      const r = await readReceipt(file);
      const cur = manualById(id); const body = { ...cur }; delete body._id;
      const old = body.photo;
      body.photo = `photos/${String(body.date).slice(0, 7)}/${body.id || id}-${Date.now().toString(36)}.jpg`;
      S.db.queuePhoto(body.photo, r.photo.b64);
      if (r.invoice && !body.inv) Object.assign(body, { inv: r.invoice.inv, seller: r.invoice.seller, items: r.invoice.items.slice(0, 40).map(i => [i.name, i.qty, i.price]) });
      if (r.invoice && !body.receipt && (body.txType || 'Expense') === 'Expense') body.receipt = 'paper';
      if (r.invoice && +r.invoice.amount !== +body.amount) toast(`發票金額 ${fmt(r.invoice.amount)} 跟這筆 ${fmt(body.amount)} 不一樣，要改的話直接改上面的總金額`);
      await write('manual/' + id, body);
      if (old && old !== body.photo) S.db.deletePhoto(old).catch(() => {});
      closeSheet(); toast('照片已加上');
    } catch (err) { msg.textContent = err.message || '照片處理失敗'; }
  });
}
async function saveRow(key) {
  const f = Object.fromEntries(new FormData($('#rowform')));
  if (f.account === '__other') f.account = (f.accountOther || '').trim();
  const r = S.res.ledger.find(x => x.key === key) || S.res.app.find(x => x.key === key);
  const detail = (S.config.detailMap || []).find(d => d.main === f.main && d.sub === f.sub);
  if (r.src === 'MANUAL') {
    const m = S.manual.find(x => x.id === r.manualId || x._id === r.manualId);
    const body = { ...m, date: f.date, amount: E.calcAmount(f.amount), desc: f.desc, account: f.account, txType: f.txType, life: +f.life, myShare: f.myShare === '' ? null : E.calcAmount(f.myShare), splitWith: f.splitWith || null, main: f.main || null, sub: f.sub || null, essential: f.essential || detail?.essential || null, fixed: f.fixed || detail?.fixed || null, receipt: E.RECEIPTS.includes(f.receipt) ? f.receipt : null };
    if ('trip' in f) { body.trip = f.trip || null; body.tripCat = f.trip ? (f.tripCat || body.tripCat || '其他') : null; }
    { const rate = m.fx && +m.fx.rate; const ms = f.myShare === '' ? null : moneyTwd(f.myShare, rate); if (ms != null && isNaN(ms)) { toast('我負擔金額看不懂'); return; }
      const w = readWho($('#f-who'), body.amount, ms, rate); if (w.err) { toast(w.err); return; } Object.assign(body, { myShare: w.myShare, splitWith: w.splitWith, splits: w.splits }); }
    if (body.myShare != null && (isNaN(body.myShare) || body.myShare < 0 || body.myShare > body.amount)) { toast(body.fx ? '我負擔金額是台幣，要介於 0 和總金額之間' : '我負擔金額要介於 0 和總金額之間'); return; }
    delete body._id;
    if (await write('manual/' + r.manualId, body)) { closeSheet(); toast('已儲存'); }
    return;
  }
  const body = { kind: 'app', key, exclude: (S.ovr.find(x => x.kind === 'app' && x.key === key) || {}).exclude || null, account: f.account && f.account !== r.account ? f.account : (S.ovr.find(x => x.kind === 'app' && x.key === key) || {}).account || null, main: f.main || null, sub: f.sub || null, essential: f.essential || null, fixed: f.fixed || null, life: +f.life, myShare: f.myShare === '' || f.myShare == null ? null : +f.myShare, splitWith: f.splitWith || null, updatedAt: new Date().toISOString() };
  if ('trip' in f) { body.trip = f.trip || null; body.tripCat = f.trip ? (f.tripCat || '其他') : null; } else { const po = S.ovr.find(x => x.kind === 'app' && x.key === key) || {}; body.trip = po.trip || null; body.tripCat = po.tripCat || null; }
  { const w = readWho($('#f-who'), r.gross ?? r.amount, body.myShare, null); if (w.err) { toast(w.err); return; } Object.assign(body, { myShare: w.myShare, splitWith: w.splitWith, splits: w.splits }); }
  if (body.myShare != null && (isNaN(body.myShare) || body.myShare < 0 || body.myShare > (r.gross ?? r.amount))) { toast('我負擔金額要介於 0 和總金額之間'); return; }
  if (f.txType) body.txType = f.txType;
  if (await write('ovr/' + hashId('a', key), body)) { closeSheet(); toast('分類已更新'); }
}
function sheetManual(prefill = {}) {
  const today = new Date(); const d = prefill.date || `${S.month}-${String(Math.min(today.getDate(), 28)).padStart(2, '0')}`;
  openSheet(`<h3>記一筆</h3><form class="form" id="manform">
    <div class="fields2"><div class="field"><label for="m-date">日期</label><input id="m-date" name="date" type="date" value="${d}"></div><div class="field"><label for="m-amt">金額</label><input id="m-amt" name="amount" inputmode="decimal" value="${prefill.amount ?? ''}" placeholder="0"></div></div>
    <div class="field"><label for="m-desc">描述</label><input id="m-desc" name="desc" value="${esc(prefill.desc || '')}" placeholder="例如：午餐 牛肉麵"></div>
    <div class="fields2"><div class="field"><label for="m-type">交易類型</label><select id="m-type" name="txType">${opt(TX, 'Expense')}</select></div>${accountField('m-acct', 'account', prefill.account || '現金', '付款帳戶')}</div>
    <div class="field"><label for="m-share">我負擔金額（代墊時填）</label><input id="m-share" name="myShare" inputmode="decimal" placeholder="全部是我的就留空"></div>${whoEditor('m-who', [])}
    <div class="chips" data-gross-from="m-amt">${[['1/2', .5], ['1/3', 1 / 3], ['1/4', .25], ['2/4', .5]].map(([l, f]) => `<button type="button" class="chip" data-act="sharefrac" data-f="${f}">我出 ${l}</button>`).join('')}</div>
    ${receiptField('m-rcpt', 'carrier')}
    <input type="hidden" name="cardKey" value="${esc(prefill.cardKey || '')}">
    <div class="fields2"><div class="field"><label for="m-main">主分類</label><select id="m-main" name="main">${opt(E.MAIN_CATS, prefill.main || '餐飲')}</select></div><div class="field"><label for="m-sub">次分類</label><input id="m-sub" name="sub" list="msub"><datalist id="msub">${subOptions(prefill.main || '餐飲').map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <p class="sub" style="margin:0">帳戶選「${esc((S.config.payrollAccounts || ['薪資扣款']).join('」或「'))}」＝公司直接從薪水扣的（例如訂餐），會算進消費，也會把同金額加回薪資收入。之後 APP 也有記同一筆的話，記得刪掉這筆。</p>
  </form><div class="acts"><button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="savemanual">新增</button></div>`);
  $('#m-main').addEventListener('change', e => { $('#msub').innerHTML = subOptions(e.target.value).map(s => `<option value="${esc(s)}">`).join(''); });
}
async function saveManual() {
  const f = Object.fromEntries(new FormData($('#manform')));
  if (f.account === '__other') f.account = (f.accountOther || '').trim();
  if (!f.date || !f.amount || isNaN(E.calcAmount(f.amount))) { toast('請填日期和金額'); return; }
  const detail = (S.config.detailMap || []).find(d => d.main === f.main && d.sub === f.sub);
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const body = { id, date: f.date, amount: E.calcAmount(f.amount), desc: f.desc, account: f.account, txType: f.txType, life: f.txType === 'Expense' ? 1 : 0, main: f.main, sub: f.sub || null, essential: detail?.essential || null, fixed: detail?.fixed || null,
    myShare: f.myShare === '' ? null : E.calcAmount(f.myShare), splitWith: f.splitWith || null, cardKey: f.cardKey || null, receipt: f.txType === 'Expense' && E.RECEIPTS.includes(f.receipt) ? f.receipt : null, createdAt: new Date().toISOString() };
  if (body.myShare != null && (isNaN(body.myShare) || body.myShare < 0 || body.myShare > body.amount)) { toast('我負擔金額要介於 0 和總金額之間'); return; }
  { const w = readWho($('#m-who'), body.amount, body.myShare, null); if (w.err) { toast(w.err); return; } Object.assign(body, { myShare: w.myShare, splitWith: w.splitWith, splits: w.splits }); }
  if (await write('manual/' + id, body)) { closeSheet(); toast('已新增'); }
}
function sheetEditBank(key) {
  const b = S.res.bank.find(x => x.key === key); if (!b) return;
  const o = S.ovr.find(x => x.kind === 'bank' && x.key === key);
  const types = Object.entries(S.config.bankTypes || {}).map(([k, v]) => [k, `${v.zh}（${TYPE_ZH[v.txType] || v.txType}）`]).concat([['OtherIncome', '其他收入（收入）'], ['Purchase', '消費（支出）'], ['LoanDisbursement', '貸款撥款（負債）']]);
  const uniq = [...new Map(types.map(t => [t[0], t])).values()];
  const defTx = Object.fromEntries(uniq.map(([k]) => [k, (S.config.bankTypes[k] || {}).txType || ({ OtherIncome: 'Income', Purchase: 'Expense', LoanDisbursement: 'Debt' })[k]]));
  openSheet(`<h3>銀行交易分類</h3>
    <div class="facts"><span><b class="num">${sgn(b.amount)}</b>・${b.date} ${b.time.replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3')}</span><span>${esc(b.account)}${b.acctNo ? '…' + esc(b.acctNo.slice(-4)) : ''}・${esc(b.desc)}</span>${b.cp ? `<span>對方帳號 <span class="mono">${esc(b.cp)}</span>${b.cpName ? '（' + esc(b.cpName) + '）' : ''}</span>` : ''}${b.note ? `<span>存摺備註：${esc(b.note)}</span>` : ''}${b.msg ? `<span>轉帳留言：${esc(b.msg)}</span>` : ''}<span class="sub">目前：${esc(b.rule)}・${TYPE_ZH[b.type] || b.type}</span></div>
    <form class="form" id="bankform">
      <div class="field"><label for="b-bt">這筆是什麼</label><select id="b-bt" name="bankType">${opt(uniq, b.bankType)}</select></div>
      <div class="fields2"><div class="field"><label for="b-tx">交易類型</label><select id="b-tx" name="txType">${opt(TX, b.type === 'Pending' ? (defTx[b.bankType] || 'Transfer') : b.type)}</select></div>
      <div class="field"><label for="b-own">收入歸屬</label><select id="b-own" name="owner">${opt([['', '—'], ['本人', '本人'], ['伴侶', '伴侶'], ['其他', '其他']], b.owner || '')}</select></div></div>
      <div class="field"><label for="b-memo">備註</label><input id="b-memo" name="memo" value="${esc((o && o.memo) || b.memo || '')}" placeholder="例如：聚餐代墊款返還"></div>
      ${b.cpKey ? `<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="rule" id="b-rule"> 以後這個對方帳號都這樣分類${b.cpName ? '' : '（可填對方名稱）'}</label><div class="field" id="b-namebox" hidden><label for="b-name">對方名稱</label><input id="b-name" name="name" value="${esc(b.cpName || '')}"></div>` : ''}
      <p class="sub" style="margin:0">轉帳＝錢在自己帳戶之間或代墊往來，不算收支；收入、投資、負債從 ${esc(S.config.bankStart)} 起以銀行為準。</p>
    </form>
    <div class="acts">${o ? `<button class="btn" data-act="resetrow" data-id="${esc(o._id)}">移除手動分類</button>` : ''}<button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="savebank" data-key="${esc(key)}">儲存</button></div>`);
  $('#b-bt').addEventListener('change', e => { if (defTx[e.target.value]) $('#b-tx').value = defTx[e.target.value]; });
  const rb = $('#b-rule'); if (rb) rb.addEventListener('change', () => { $('#b-namebox').hidden = !rb.checked; });
}
async function saveBank(key) {
  const f = Object.fromEntries(new FormData($('#bankform')));
  const b = S.res.bank.find(x => x.key === key);
  if (f.rule && b.cpKey) {
    const body = { kind: 'cprule', cp: b.cp, name: f.name || b.cp, bankType: f.bankType, txType: f.txType, owner: f.owner || null, memo: f.memo || null, createdAt: new Date().toISOString() };
    if (await write('ovr/' + hashId('r', b.cpKey), body)) { closeSheet(); toast('已建立對手方規則'); }
    return;
  }
  const body = { kind: 'bank', key, bankType: f.bankType, txType: f.txType, owner: f.owner || null, memo: f.memo || null, updatedAt: new Date().toISOString() };
  if (await write('ovr/' + hashId('b', key), body)) { closeSheet(); toast('已分類'); }
}
function sheetPair(side, key, preKeys) {
  const r = S.res;
  const used = new Set(r.recon.filter(x => x.status === '成功配對').flatMap(x => [...(x.apps || []).map(a => a.key), x.card && x.card.key]));
  const cardAcct = E.util.normApp(S.config.cardAccount || '玉山 unicard');
  const amt = a => a.gross ?? a.amount;
  if (side === 'app') { // choose the card line, then refine on the card side
    const self = r.app.find(a => a.key === key); if (!self) return;
    const cands = r.card.filter(c => !used.has(c.key) && Math.abs(E.util.dayDiff(c.date, self.date)) <= 5)
      .map(c => ({ c, score: Math.abs(c.amount - amt(self)) / Math.max(1, amt(self)) + Math.abs(E.util.dayDiff(c.date, self.date)) * 0.02 })).sort((a, b) => a.score - b.score).slice(0, 12);
    openSheet(`<h3>找對應的刷卡紀錄</h3><div class="facts"><b>${esc(self.desc || self.bill)}</b><span class="num">${self.date}・${fmt(amt(self))}</span></div><div class="sub">選了刷卡紀錄後，下一步可以再勾其他同一次刷卡的 APP 紀錄（例如餐點＋飲料分開記）。</div>
      <div class="list">${cands.map(({ c }) => `<button type="button" class="row" data-act="pairpick" data-side="card" data-key="${esc(c.key)}" data-pre="${esc(key)}"><span><span class="t">${esc(c.merchant)}</span><span class="m">${c.date}${c.amount !== amt(self) ? `<span class="pill warn">差 ${sgn(c.amount - amt(self))}</span>` : ''}</span></span><span class="a">${fmt(c.amount)}</span></button>`).join('') || '<div class="sub">前後 5 天內沒有候選。若其實是付現或用別張卡，按「改帳戶」。</div>'}</div>
      <div class="acts"><button class="btn" data-act="editrow" data-key="${esc(key)}">改帳戶</button><button class="btn" data-act="ignore" data-key="${esc(key)}">忽略</button><button class="btn" data-act="closesheet">關閉</button></div>`);
    return;
  }
  const c = r.card.find(x => x.key === key); if (!c) return;
  const pre = new Set(preKeys || []);
  const cands = r.app.filter(a => a.include === 1 && a.type === 'Expense' && E.util.normApp(a.account) === cardAcct && (!used.has(a.key) || pre.has(a.key)) && Math.abs(E.util.dayDiff(a.date, c.date)) <= 5)
    .sort((a, b) => (pre.has(b.key) - pre.has(a.key)) || Math.abs(E.util.dayDiff(a.date, c.date)) - Math.abs(E.util.dayDiff(b.date, c.date)) || Math.abs(amt(a) - c.amount) - Math.abs(amt(b) - c.amount)).slice(0, 16);
  openSheet(`<h3>這筆刷卡對應哪些 APP 紀錄？</h3><div class="facts"><b>${esc(c.merchant)}</b><span class="num">${c.date}・帳單 ${fmt(c.amount)}</span></div>
    <form id="pairform" class="list">${cands.map(a => `<label class="row" style="grid-template-columns:auto 1fr auto;cursor:pointer"><input type="checkbox" name="k" value="${esc(a.key)}" data-amt="${amt(a)}" ${pre.has(a.key) ? 'checked' : ''}><span><span class="t">${esc(a.desc || a.bill)}</span><span class="m"><span>${a.date}・${esc(a.bill || '')}</span></span></span><span class="a">${fmt(amt(a))}</span></label>`).join('') || '<div class="sub">前後 5 天內沒有刷這張卡的 APP 紀錄，可以直接補記。</div>'}</form>
    <div class="facts" id="pairsum"></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:14px" id="adjbox"><input type="checkbox" id="pair-adjust" checked> 差額以帳單為準，自動補一筆調整</label>
    <div class="acts"><button class="btn" data-act="cardadd" data-key="${esc(key)}">改成補記</button><button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="pairmulti" data-c="${esc(key)}">配對</button></div>`);
  const upd = () => { const ch = [...document.querySelectorAll('#pairform input:checked')]; const sum = ch.reduce((t, i) => t + +i.dataset.amt, 0); const d = c.amount - sum;
    document.querySelectorAll('#pairform input').forEach(i => { const hit = !i.checked && ch.length && Math.abs(+i.dataset.amt - d) < 0.01; const lab = i.closest('label'); lab.style.background = hit ? 'var(--accent-soft)' : ''; let tag = lab.querySelector('.fillhint'); if (hit && !tag) { tag = document.createElement('span'); tag.className = 'pill acc fillhint'; tag.textContent = '剛好補足差額'; lab.querySelector('.m').appendChild(tag); } else if (!hit && tag) tag.remove(); });
    $('#pairsum').innerHTML = `已選 ${ch.length} 筆，合計 <b class="num">${fmt(sum)}</b>${ch.length ? (Math.abs(d) < 0.01 ? '・<span class="pos">金額相符</span>' : `・與帳單差 <b class="num">${sgn(d)}</b>`) : ''}`; $('#adjbox').hidden = !ch.length || Math.abs(d) < 0.01; };
  $('#pairform').addEventListener('change', upd); upd();
}
function sheetDebt(i) {
  const d = i >= 0 ? S.config.debts[i] : { name: '', type: '0%分期', principal: '', rate: 0, n: '', start: S.month, payment: '' };
  openSheet(`<h3>${i >= 0 ? '編輯' : '新增'}分期／貸款</h3><form class="form" id="debtform">
    <div class="fields2"><div class="field"><label for="d-name">名稱</label><input id="d-name" name="name" value="${esc(d.name)}"></div><div class="field"><label for="d-type">類型</label><select id="d-type" name="type">${opt(['0%分期', '信貸', '車貸', '其他'], d.type)}</select></div></div>
    <div class="fields2"><div class="field"><label for="d-p">原始本金</label><input id="d-p" name="principal" inputmode="numeric" value="${d.principal ?? ''}"></div><div class="field"><label for="d-r">年利率（%）</label><input id="d-r" name="rate" inputmode="decimal" value="${d.rate ? +(d.rate * 100).toFixed(4) : 0}"></div></div>
    <div class="fields2"><div class="field"><label for="d-n">總期數</label><input id="d-n" name="n" inputmode="numeric" value="${d.n ?? ''}"></div><div class="field"><label for="d-s">第一期月份</label><input id="d-s" name="start" type="month" value="${esc(d.start || '')}"></div></div>
    <div class="fields2"><div class="field"><label for="d-pay">每月應付（空白自動算）</label><input id="d-pay" name="payment" inputmode="decimal" value="${d.payment ?? ''}"></div><div class="field"><label for="d-bo">目前剩餘本金（銀行數字，選填）</label><input id="d-bo" name="balanceOverride" inputmode="numeric" value="${d.balanceOverride ?? ''}"></div></div>
  </form><div class="acts">${i >= 0 ? `<button class="btn danger" data-act="debtdel" data-i="${i}">刪除</button>` : ''}<button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="debtsave" data-i="${i}">儲存</button></div>`);
}
async function saveDebt(i, del) {
  const debts = [...(S.config.debts || [])];
  if (del) debts.splice(i, 1);
  else {
    const f = Object.fromEntries(new FormData($('#debtform')));
    const num = v => v === '' || v == null ? undefined : +String(v).replace(/,/g, '');
    const d = { name: f.name || '未命名', type: f.type, principal: num(f.principal), rate: (num(f.rate) || 0) / 100, n: num(f.n), start: f.start || undefined, payment: num(f.payment), balanceOverride: num(f.balanceOverride) };
    Object.keys(d).forEach(k => d[k] === undefined && delete d[k]);
    if (i >= 0) debts[i] = d; else debts.push(d);
  }
  try { await S.db.doc('config/main').update({ debts }); closeSheet(); toast(del ? '已刪除' : '已儲存'); } catch (e) { toast('儲存失敗：' + (e.message || e.code)); }
}

function sheetSettle(key, who) {
  const rv = S.res.receivables.find(x => x.key === key); if (!rv) return;
  const pp = who && rv.people.find(p => p.who === who); const due = pp ? pp.open : rv.open;
  const usedTx = new Set(S.ovr.filter(o => o.kind === 'settle').map(o => o.txKey));
  const appC = S.res.app.filter(a => !usedTx.has(a.key) && a.date >= rv.date && (a.bill === '代墊款回收' || a.rawType === '收入'))
    .map(a => ({ key: a.key, date: a.date, amount: Math.abs(a.gross ?? a.amount), label: (a.desc || a.bill) + '・APP ' + (a.account || '') }));
  const bankC = S.res.bank.filter(b => !usedTx.has(b.key) && b.dup === 0 && b.amount > 0 && b.date >= rv.date && ['FriendPayment', 'UnclassifiedInflow', 'PartnerContribution'].includes(b.bankType))
    .map(b => ({ key: b.key, date: b.date, amount: b.amount, label: (b.cpName || b.cp || b.desc) + '・' + b.account + (b.msg ? '・' + b.msg : '') }));
  const cands = [...appC, ...bankC].sort((a, b) => Math.abs(a.amount - due) - Math.abs(b.amount - due) || a.date.localeCompare(b.date)).slice(0, 15);
  openSheet(`<h3>記錄收回代墊款</h3><div class="facts"><b>${esc(rv.desc)}・${esc(pp ? pp.who : rv.who)}</b><span class="num">${rv.date}・未收 ${fmt(due)}</span></div>
    <div class="field"><label for="st-amt">這次收回金額</label><input id="st-amt" inputmode="decimal" value="${due}"></div>
    <div class="list">${cands.map(c => `<button type="button" class="row" data-act="settlepick" data-r="${esc(key)}" data-t="${esc(c.key)}" data-w="${esc(pp ? pp.who : '')}"><span><span class="t">${esc(c.label)}</span><span class="m">${c.date}</span></span><span class="a pos">+${fmt(c.amount)}</span></button>`).join('') || '<div class="sub">找不到之後的入帳紀錄。</div>'}</div>
    <div class="sub">選了 APP 的「代墊款回收」後，那筆就不會再沖減你的消費，改成收回應收款。</div>
    <div class="acts"><button class="btn" data-act="settlecash" data-r="${esc(key)}" data-w="${esc(pp ? pp.who : '')}">已收回（現金或其他方式）</button><button class="btn" data-act="closesheet">取消</button></div>`);
}

// ---------------------------------------------------------------- STOCK LEDGER (same origin, read-only)
// 只讀不寫。新版 Stock Claude 優先，舊版 Stock Ledger 為備援。
const STOCK_KEYS = [['stock-claude:db', 'Stock Claude'], ['stock-ledger-v2-preloaded', 'Stock Ledger']];
function stockLedgerLocal() {
  for (const [key, label] of STOCK_KEYS) {
    try { const raw = localStorage.getItem(key); if (!raw) continue; const json = JSON.parse(raw);
      if (Array.isArray(json.trades) || Array.isArray(json.transactions)) return { json, label }; } catch (e) { /* 讀不到就換下一個 */ }
  }
  return null;
}
async function syncStockLedger(manual) {
  const hit = stockLedgerLocal();
  if (!hit) { if (manual) toast('這台裝置的瀏覽器裡找不到投資總帳資料'); return false; }
  const { json, label } = hit;
  const snap = E.parseInvestAny(label + '（本機同步）', json);
  if (!snap.asOf) snap.asOf = (json.meta || {}).lastQuoteSnapshot || new Date().toISOString();
  const body = JSON.stringify([snap.holdings, snap.external, snap.brokerCashTwd]);
  snap.hash = E.util.hash(body) + body.length.toString(36);
  const old = S.raw.find(f => f._id === 'invest.live');
  if (old && old.hash === snap.hash) { if (manual) toast('投資部位已是最新'); return false; }
  snap.syncedAt = new Date().toISOString();
  S.db.doc('raw/invest.live').set(snap).catch(() => {});
  toast('已從 ' + label + ' 同步投資部位'); return true;
}

// ---------------------------------------------------------------- RECEIPT PHOTO（拍照記帳：讀電子發票 QR、照片存進資料 repo）
const APP_V = ((document.querySelector('script[src*="app.js"]') || {}).src || '').split('v=')[1] || '';
let jsqrLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return (jsqrLoading ||= new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = './jsQR.js?v=' + APP_V; sc.onload = () => ok(window.jsQR); sc.onerror = () => { jsqrLoading = null; no(new Error('QR 模組載入失敗')); }; document.head.appendChild(sc); }));
}
async function loadImage(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back to <img> */ } }
  return new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => no(new Error('讀不到這張照片')); img.src = URL.createObjectURL(file); });
}
function drawScaled(img, max, crop) {
  const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0, sw = crop ? crop.w : img.width, sh = crop ? crop.h : img.height;
  const k = Math.min(max / Math.max(sw, sh), crop ? 4 : 1);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
async function scanQRs(img) {
  const found = new Map();
  const add = (text, bytes) => { const key = bytes && bytes.length ? Array.from(bytes, x => String.fromCharCode(x)).join('') : text; if (key && !found.has(key)) found.set(key, { text: text || key, bytes: bytes && bytes.length ? Array.from(bytes) : null }); };
  const hasLeft = () => [...found.keys()].some(t => /^[A-Z]{2}\d{15}/.test(t));
  const jsQR = await loadJsQR().catch(() => null);
  const readCanvas = c => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); return jsQR ? jsQR(d.data, d.width, d.height) : null; };
  // Android Chrome：原生偵測找位置，再用 jsQR 讀原始位元組（Big5 品名才解得對）
  if ('BarcodeDetector' in window) {
    try {
      const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(img);
      for (const code of codes) {
        const b = code.boundingBox, pad = Math.max(b.width, b.height) * 0.25;
        const crop = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), w: Math.min(img.width, b.width + pad * 2), h: Math.min(img.height, b.height + pad * 2) };
        const r = jsQR ? readCanvas(drawScaled(img, 600, crop)) : null;
        if (r) add(r.data, r.binaryData); else add(code.rawValue, null);
      }
    } catch (e) { /* detector unsupported for this image */ }
  }
  if (!jsQR || hasLeft()) return [...found.values()];
  // 其他瀏覽器（iPhone Safari）：jsQR 一次找一個，找到就塗白再找下一個
  for (const max of [1400, 2400]) {
    const c = drawScaled(img, max), ctx = c.getContext('2d', { willReadFrequently: true });
    for (let n = 0; n < 4; n++) {
      const r = readCanvas(c); if (!r) break;
      add(r.data, r.binaryData);
      const L = r.location, xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x], ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), p = (x1 - x0) * 0.12;
      ctx.fillStyle = '#fff'; ctx.fillRect(x0 - p, y0 - p, x1 - x0 + 2 * p, y1 - y0 + 2 * p);
    }
    if (hasLeft() || max >= Math.max(img.width, img.height)) break;
  }
  return [...found.values()];
}
function compressPhoto(img) {
  const c = drawScaled(img, 1600);
  let url = c.toDataURL('image/jpeg', 0.72);
  if (url.length > 900000) url = c.toDataURL('image/jpeg', 0.55);
  return { b64: url.split(',')[1], w: c.width, h: c.height };
}
async function readReceipt(file) {
  const img = await loadImage(file);
  const raws = await scanQRs(img).catch(() => []);
  const photo = compressPhoto(img);
  return { photo, invoice: E.parseInvoiceQR(E.decodeInvoiceQRs(raws)), qrCount: raws.length };
}
function manualById(id) { return S.manual.find(x => x.id === id || x._id === id); }
function invoiceSummary(p, opts = {}) {
  if (!p) return '';
  const dup = S.manual.find(m => m.inv === p.inv && m.id !== opts.selfId);
  return `<b>電子發票 ${esc(p.inv.slice(0, 2))}-${esc(p.inv.slice(2))}</b><span class="sub">${p.date}・總計 ${fmt(p.amount)}・賣方統編 ${esc(p.seller)}</span>
    ${dup ? `<span class="pill warn">這張發票 ${esc(dup.date)} 已經記過了</span>` : ''}
    ${p.items.length ? `<details><summary>${p.items.length} 個品項</summary><div class="qitems">${p.items.map(i => `<span>${esc(i.name)}</span><span class="num">${i.qty} × ${fmt(i.price)}</span>`).join('')}</div></details>` : ''}`;
}
function renderPhotoBox() {
  const box = $('#q-photo-box'); if (!box) return;
  if (!Q.photo) { box.innerHTML = ''; return; }
  const p = Q.invoice;
  box.innerHTML = `<div class="qphoto-card"><img src="data:image/jpeg;base64,${Q.photo.b64}" alt="收據照片" data-act="viewphoto" data-local="1"><div class="qphoto-info">
    ${p ? invoiceSummary(p) + (Q.sellerHit ? `<span class="sub">分類和帳戶照上次在這家（${esc(Q.sellerHit)}）</span>` : '') : `<b>沒讀到發票 QR Code</b><span class="sub">${Q.qrCount ? '有讀到 QR，但不是電子發票格式。' : ''}照片會跟這筆一起存。想自動帶入金額，可以重拍一次，讓左右兩個 QR Code 都清楚入鏡。</span>`}
    <button type="button" class="linkbtn" data-act="qphotodel">移除照片</button></div></div>`;
}
async function handleQuickPhoto(file) {
  const box = $('#q-photo-box'); if (!file || !box) return;
  box.innerHTML = '<div class="sub">辨識中…</div>';
  try {
    const r = await readReceipt(file);
    Object.assign(Q, { photo: r.photo, invoice: r.invoice, qrCount: r.qrCount, sellerHit: null, dupOk: false });
    const p = r.invoice;
    if (p) {
      $('#q-amt').value = p.amount; $('#q-date').value = p.date;
      Q.receipt = 'paper'; Q.rcptTouched = true; renderReceiptBtn(); // 拍得到 QR Code 的電子發票證明聯＝紙本
      const prev = S.manual.filter(m => m.seller === p.seller && m.main).sort((a, b) => String(a.createdAt || a.date).localeCompare(String(b.createdAt || b.date))).pop();
      if (prev) { Q.main = prev.main; Q.sub = prev.sub || null; if (prev.account) { Q.account = prev.account; Q.touched = true; } Q.sellerHit = prev.desc || prev.main; }
      const d = $('#q-desc'); if (!d.value.trim()) d.value = E.invoiceDesc(p) || (prev && prev.desc) || '';
      renderQuickCats();
    }
    renderPhotoBox();
  } catch (e) { box.innerHTML = `<div class="sub">${esc(e.message || '照片處理失敗')}</div>`; }
}
async function sheetPhoto(path, local) {
  const src = local && Q.photo ? 'data:image/jpeg;base64,' + Q.photo.b64 : null;
  const root = document.createElement('div'); root.className = 'photoview'; root.innerHTML = `<div class="photoview-bar"><span class="sub">收據照片</span><button class="btn small" type="button">關閉</button></div><div class="photoview-body"><div class="sub">載入中…</div></div>`;
  document.body.appendChild(root);
  root.querySelector('button').addEventListener('click', () => root.remove());
  try { const url = src || await S.db.photoUrl(path); root.querySelector('.photoview-body').innerHTML = `<img src="${url}" alt="收據照片">`; }
  catch (e) { root.querySelector('.photoview-body').innerHTML = `<div class="sub">${esc(e.message)}</div>`; }
}

function auditSection(m) {
  const list = E.auditMonth(S.res.ledger, m, S.ovr); if (!list.length) return '';
  const L = new Map(S.res.ledger.map(r => [r.key, r]));
  const label = { dup: '可能重複', outlier: '金額怪怪的', nodesc: '沒寫描述' };
  return `<section class="panel"><header><h2>可能記錯</h2><span class="pill warn">${list.length} 筆</span></header>
    <div class="list">${list.map(x => { const r = L.get(x.key); if (!r) return ''; return `<div class="row" style="cursor:default"><span><span class="t">${esc(r.desc || r.bill || r.main || '')}</span><span class="m"><span class="pill warn">${label[x.kind]}</span><span>${r.date.slice(5).replace('-', '/')}</span><span>${esc(r.src === 'APP' ? '舊 APP' : '手動')}</span></span><span class="m">${esc(x.note)}</span></span><span class="a">${fmt(r.gross ?? r.amount)}<br><span style="display:inline-flex;gap:6px;margin-top:4px"><button class="btn small" data-act="editrow" data-key="${esc(r.key)}">查看</button><button class="btn small" data-act="auditok" data-key="${esc(r.key)}">沒問題</button></span></span></div>`; }).join('')}</div>
    <div class="sub">重複的：手動記的直接刪掉，舊 APP 的點進去按「標記為重複」。確認沒問題就按「沒問題」，之後不會再出現。</div></section>`;
}
// ---------------------------------------------------------------- 載具發票對帳
function einvItemsText(x, n = 3) {
  const names = (x.items || []).filter(i => i.amount !== 0 && !/^(折讓|服務費|清潔費)$/.test(i.name)).map(i => i.name);
  return names.length ? names.slice(0, n).join('、') + (names.length > n ? ` 等 ${names.length} 項` : '') : '';
}
function einvSection(m) {
  const all = S.res.einv || [];
  const hasFiles = S.raw.some(f => f.kind === 'einvoice');
  const ev = all.filter(x => x.date.slice(0, 7) === m);
  const btn = `<label class="btn small" for="einv-file">匯入 CSV</label><input id="einv-file" type="file" accept=".csv,text/csv,text/comma-separated-values" hidden>`;
  if (!hasFiles) return `<section class="panel"><header><h2>載具發票</h2>${btn}</header><div class="sub">在手機上到財政部電子發票平台「下載 CSV 檔」，回來按「匯入 CSV」選剛下載的檔案，就能抓出漏記的消費、幫已記的帳補上店名。</div></section>`;
  if (!ev.length) return `<section class="panel"><header><h2>載具發票</h2>${btn}</header><div class="sub">還沒有 ${mLabel(m)} 的載具發票資料。</div></section>`;
  const by = k => ev.filter(x => x.status === k);
  const ok = by('已對上'), sug = by('待確認'), miss = by('帳上找不到'), ign = by('已忽略');
  const L = new Map(S.res.ledger.map(r => [r.key, r]));
  const carrierMiss = (S.res.einvMissing || []).map(k => L.get(k)).filter(r => r && r.month === m);
  const paperN = S.res.ledger.filter(r => r.month === m && r.receipt === 'paper').length;
  const head = x => `<span class="t">${esc(x.store)}</span><span class="m"><span>${x.date.slice(5).replace('-', '/')}</span>${einvItemsText(x) ? `<span>${esc(einvItemsText(x))}</span>` : ''}</span>`;
  return `<section class="panel"><header><h2>載具發票</h2><span style="display:flex;gap:6px;align-items:center"><span class="pill ${miss.length + sug.length + carrierMiss.length ? 'warn' : 'ok'}">${miss.length + sug.length + carrierMiss.length ? `${miss.length + sug.length + carrierMiss.length} 筆要看` : '全部對上'}</span>${btn}</span></header>
    <div class="sub">資料到 ${esc((all[all.length - 1] || {}).date || '')}</div>
    <div class="sub">共 ${ev.length} 張・已對上 ${ok.length}${sug.length ? `・待確認 ${sug.length}` : ''}${miss.length ? `・帳上找不到 ${miss.length}` : ''}${ign.length ? `・已忽略 ${ign.length}` : ''}</div>
    ${sug.length ? `<h3 class="mini">金額差一點，是同一筆嗎？</h3><div class="pairs">${sug.map(x => { const r = L.get(x.suggest); return `<div class="pair"><div class="side"><span class="k">載具發票</span><span>${esc(x.store)}</span><span class="sub num">${x.date}・${fmt(x.total)}</span></div><div class="side"><span class="k">帳上</span><span>${esc(r.desc || r.bill || '')}</span><span class="sub num">${r.date}・${fmt(r.gross ?? r.amount)}・差 ${fmt(x.total - (r.gross ?? r.amount))}</span></div><div class="acts"><button class="btn small primary" data-act="einvlink" data-inv="${esc(x.inv)}" data-key="${esc(r.key)}">是同一筆</button><button class="btn small" data-act="einvnot" data-inv="${esc(x.inv)}" data-key="${esc(r.key)}">不是</button></div></div>`; }).join('')}</div>` : ''}
    ${miss.length ? `<h3 class="mini">帳上找不到（可能漏記）</h3><div class="list">${miss.map(x => `<div class="row" style="cursor:default"><span>${head(x)}</span><span class="a">${fmt(x.total)}<br><span style="display:inline-flex;gap:6px;margin-top:4px"><button class="btn small primary" data-act="einvadd" data-inv="${esc(x.inv)}">補記</button><button class="btn small" data-act="einvign" data-inv="${esc(x.inv)}">忽略</button></span></span></div>`).join('')}</div>
      <div class="sub">「忽略」用在不是你付的（例如別人用你的載具）、或已經用別的方式記過的。</div>` : ''}
    ${carrierMiss.length ? `<h3 class="mini">標了載具，雲端卻找不到</h3><div class="list">${carrierMiss.map(r => `<button type="button" class="row" data-act="editrow" data-key="${esc(r.key)}"><span><span class="t">${esc(r.desc || r.bill || r.main || '')}</span><span class="m"><span>${r.date.slice(5).replace('-', '/')}</span><span>${esc(r.account || '')}</span></span></span><span class="a">${fmt(r.gross ?? r.amount)}</span></button>`).join('')}</div>
      <div class="sub">可能結帳時忘了刷條碼、金額記錯，或其實拿的是紙本。點進去改金額，或把「發票」改成紙本／無發票。</div>` : ''}
    ${paperN ? `<div class="sub">這個月有 ${paperN} 張紙本發票，記得留著對獎 🧾</div>` : ''}
    ${ok.length ? `<details><summary>已對上 ${ok.length} 張（已幫這些帳補上店名）</summary><div class="list">${ok.map(x => { const r = L.get(x.match); return `<button type="button" class="row" data-act="editrow" data-key="${esc(x.match)}"><span>${head(x)}<span class="m"><span>← ${esc(r ? (r.desc || r.bill || '') : '')}</span>${x.how && x.how !== '金額日期相同' ? `<span>${esc(x.how)}${x.dayGap ? `（差 ${Math.abs(x.dayGap)} 天）` : ''}</span>` : ''}</span></span><span class="a">${fmt(x.total)}</span></button>`; }).join('')}</div></details>` : ''}
    ${ign.length ? `<details><summary>已忽略 ${ign.length} 張</summary><div class="list">${ign.map(x => `<div class="row" style="cursor:default"><span>${head(x)}</span><span class="a">${fmt(x.total)}<br><button class="linkbtn" data-act="einvundo" data-inv="${esc(x.inv)}">還原</button></span></div>`).join('')}</div></details>` : ''}
  </section>`;
}
async function importEinvoiceFile(file) {
  try {
    const buf = await file.arrayBuffer(); let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { text = new TextDecoder('big5').decode(buf); }
    const doc = E.parseEinvoiceCSV(file.name, text);
    const body = JSON.stringify(doc.rows); doc.hash = E.util.hash(body) + body.length.toString(36); doc.importedAt = new Date().toISOString();
    const id = E.fileDocId('einvoice', doc.file);
    const old = S.raw.find(f => f._id === id);
    if (old && old.hash === doc.hash) { toast('這份 CSV 已經匯入過了'); return; }
    if (await write('raw/' + id, doc)) {
      if (doc.month && monthsAvailable().includes(doc.month)) { S.month = doc.month; render(); }
      setTimeout(() => { const n = (S.res.einv || []).filter(x => x.date.slice(0, 7) === doc.month); toast(`已匯入 ${doc.rows.length} 張發票（${doc.from.slice(5)}～${doc.to.slice(5)}）・帳上找不到 ${n.filter(x => x.status === '帳上找不到').length} 張`); }, 400);
    }
  } catch (e) { toast(e.message || 'CSV 讀取失敗'); }
}
function einvQuick(inv) {
  const x = (S.res.einv || []).find(e => e.inv === inv); if (!x) return;
  // 同一家店之前對上的帳 → 沿用分類和帳戶
  const L = new Map(S.res.ledger.map(r => [r.key, r]));
  const prev = (S.res.einv || []).filter(e => e.sellerId === x.sellerId && e.match).map(e => L.get(e.match)).filter(r => r && r.main).pop()
    || S.manual.filter(m => m.seller === x.sellerId && m.main).pop();
  const items = einvItemsText(x, 2);
  sheetQuick({ amount: x.total, date: x.date, desc: x.store + (items ? ' ' + items : ''), main: prev ? prev.main : null, account: prev ? prev.account : null, einv: x, prevSub: prev ? prev.sub : null });
}
// ---------------------------------------------------------------- 手勢：整頁左右滑切換分頁、明細紀錄左滑出現「複製」
const amtOf$ = sel => { const el = $(sel); const v = el ? E.calcAmount(el.value) : null; return v == null || isNaN(v) ? 0 : v; };
const SW = { mode: null };
const SWIPE_W = 88;
const a0 = el => el && el.dataset ? el.dataset.act : null;
function goTab(k, dir) {
  if (!k || k === S.tab) return;
  S.tab = k; try { localStorage.setItem('fin.tab', k); } catch (_) {}
  closeSheet(); render(); window.scrollTo({ top: 0 });
  const v = $('#view'); if (dir && v && v.animate) v.animate([{ transform: `translateX(${dir * 28}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
}
function scrollsX(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) { const ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll') return true; }
  }
  return false;
}
function closeSwipe(row) { row.classList.remove('open'); const fg = row.querySelector('.swipe-fg'); if (fg) fg.style.transform = ''; }
function openSwipe(row) { document.querySelectorAll('.swipe.open').forEach(r => r !== row && closeSwipe(r)); row.classList.add('open'); const fg = row.querySelector('.swipe-fg'); if (fg) fg.style.transform = ''; }
document.addEventListener('touchstart', e => {
  SW.mode = null;
  if (e.touches.length !== 1 || document.querySelector('#sheet-root .sheet') || document.querySelector('.photoview')) return;
  const t = e.touches[0], tgt = e.target;
  SW.x0 = t.clientX; SW.y0 = t.clientY; SW.t0 = Date.now(); SW.dx = 0; SW.mode = 'wait';
  SW.row = tgt.closest('.swipe'); if (SW.row && !SW.row.querySelector('.swipe-acts')) SW.row = null;
  const edge = t.clientX < 24 || t.clientX > window.innerWidth - 24; // 留給系統的返回手勢
  SW.pageOk = !edge && !!tgt.closest('#view') && !tgt.closest('input,select,textarea,[data-noswipe],.chart,table') && !scrollsX(tgt);
  document.querySelectorAll('.swipe.open').forEach(r => r !== SW.row && closeSwipe(r));
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!SW.mode) return;
  const t = e.touches[0], dx = t.clientX - SW.x0, dy = t.clientY - SW.y0;
  if (SW.mode === 'wait') {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    const horiz = Math.abs(dx) > Math.abs(dy) * 1.3;
    SW.mode = !horiz ? null : SW.row && (dx < 0 || SW.row.classList.contains('open')) ? 'row' : SW.pageOk ? 'page' : null;
    if (!SW.mode) return;
    if (SW.mode === 'row') SW.row.classList.add('dragging');
  }
  SW.dx = dx;
  if (SW.mode === 'row') {
    const base = SW.row.classList.contains('open') ? -SWIPE_W : 0;
    const x = Math.max(-SWIPE_W * 1.25, Math.min(0, base + dx));
    SW.row.querySelector('.swipe-fg').style.transform = `translateX(${x}px)`;
  }
}, { passive: true });
document.addEventListener('touchend', () => {
  if (SW.mode === 'row') {
    const row = SW.row; row.classList.remove('dragging');
    const final = (row.classList.contains('open') ? -SWIPE_W : 0) + SW.dx;
    if (final < -SWIPE_W / 2) openSwipe(row); else closeSwipe(row);
    SW.done = Date.now();
  } else if (SW.mode === 'page' && Math.abs(SW.dx) > 70 && Date.now() - SW.t0 < 700) {
    const i = TABS.findIndex(x => x[0] === S.tab), j = i + (SW.dx < 0 ? 1 : -1);
    if (TABS[j]) { goTab(TABS[j][0], SW.dx < 0 ? 1 : -1); SW.done = Date.now(); }
  }
  SW.mode = null;
}, { passive: true });
document.addEventListener('touchcancel', () => { if (SW.mode === 'row' && SW.row) { SW.row.classList.remove('dragging'); closeSwipe(SW.row); } SW.mode = null; }, { passive: true });
function copyRow(key) {
  const r = S.res.ledger.find(x => x.key === key) || S.res.app.find(x => x.key === key);
  if (!r || r.type !== 'Expense') { toast('只能複製支出'); return; }
  const m = r.src === 'MANUAL' ? manualById(r.manualId) : null;
  closeSheet();
  sheetQuick({ amount: r.gross ?? r.amount, desc: r.desc || r.bill || '', main: E.MAIN_CATS.includes(r.main) ? r.main : null, prevSub: r.sub || null, account: r.account || null, receipt: m && m.receipt, date: todayISO() });
  toast('已帶入同樣的內容，日期是今天');
}

// ---------------------------------------------------------------- QUICK ENTRY
const Q = {};
const RECEIPT_ZH = { carrier: '📱 載具', paper: '🧾 紙本', none: '— 無發票' };
const RECEIPT_TIP = { carrier: '存在手機條碼，雲端查得到', paper: '拿了紙本，記得留著對獎', none: '沒有發票（轉帳、小吃攤、代墊…）' };
// 發票狀態的預設：同描述上次怎麼標就沿用；房租、孝親、保險、薪資扣款這類沒有發票；其他預設載具。使用者點過或拍到紙本就不再自動改。
const NO_RECEIPT_MAINS = ['住房', '家庭責任', '保險與法定費用'];
function guessReceipt() {
  if (Q.rcptTouched || Q.type !== 'Expense') return;
  let r = 'carrier';
  if (!(Q.invoice && Q.invoice.fromCarrier)) {
    const desc = (($('#q-desc') || {}).value || '').trim();
    const hit = desc ? S.manual.filter(m => (m.desc || '').trim() === desc && E.RECEIPTS.includes(m.receipt)).sort((a, b) => String(a.createdAt || a.date).localeCompare(String(b.createdAt || b.date))).pop() : null;
    if (hit) r = hit.receipt;
    else if (NO_RECEIPT_MAINS.includes(Q.main) || (S.config.payrollAccounts || []).includes(Q.account) || (S.config.mealPlan && Q.sub === (S.config.mealPlan.allowanceSub || '青穎餐費'))) r = 'none';
  }
  if (r !== Q.receipt) { Q.receipt = r; renderReceiptBtn(); }
}
function renderReceiptBtn() {
  const b = $('#q-rcpt'); if (!b) return;
  b.textContent = RECEIPT_ZH[Q.receipt]; b.title = RECEIPT_TIP[Q.receipt] + '（點一下切換）'; b.setAttribute('aria-label', '發票：' + RECEIPT_TIP[Q.receipt] + '，點一下切換');
  b.hidden = Q.type !== 'Expense' || (Q.cur && Q.cur !== 'TWD');
}
function quickStats() {
  const since = E.util.addMonths(todayISO().slice(0, 7), -3) + '-01';
  const rows = S.res.app.filter(a => a.date >= since && a.type === 'Expense' && (a.desc || a.bill));
  const tpl = new Map(), mainN = new Map(), acctN = new Map();
  for (const a of rows) {
    const desc = (a.desc || a.bill || '').trim(); const amt = a.gross ?? a.amount;
    const k = [desc, amt, a.main, a.sub, a.account].join('|');
    const t = tpl.get(k) || { desc, amount: amt, main: a.main, sub: a.sub, account: a.account, n: 0, last: '' };
    t.n++; if (a.date > t.last) t.last = a.date; tpl.set(k, t);
    if (a.main) mainN.set(a.main, (mainN.get(a.main) || 0) + 1);
    if (a.account) acctN.set(a.account, (acctN.get(a.account) || 0) + 1);
  }
  const templates = [...tpl.values()].filter(t => t.n >= 2 && t.main).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, 10);
  const mains = [...new Set([...[...mainN.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).filter(m => E.MAIN_CATS.includes(m)), ...E.MAIN_CATS])];
  const accts = [...acctN.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 5);
  const byDesc = new Map(); for (const a of [...rows].sort((x, y) => x.date.localeCompare(y.date))) byDesc.set((a.desc || a.bill || '').trim(), a);
  return { templates, mains, accts, byDesc };
}
function sheetQuick(pre = {}) {
  Object.keys(Q).forEach(k => delete Q[k]);
  const st = quickStats(); Q.st = st;
  Object.assign(Q, { type: 'Expense', main: pre.main || null, sub: pre.prevSub || null, account: pre.account || st.accts[0] || '現金', cardKey: pre.cardKey || null, touched: !!pre.account, receipt: 'carrier' });
  if (E.RECEIPTS.includes(pre.receipt)) { Q.receipt = pre.receipt; Q.rcptTouched = true; }
  setQuickTrip(pre.date || todayISO(), !!pre.cardKey);
  if (pre.einv) Q.invoice = { inv: pre.einv.inv, seller: pre.einv.sellerId, items: pre.einv.items.filter(i => i.amount !== 0).map(i => ({ name: i.name, qty: i.qty, price: i.price })), fromCarrier: true };
  openSheet(`<div class="qhead"><h3>${pre.cardKey ? '補記刷卡' : '記一筆'}</h3><div class="qcam"><button type="button" class="btn small" id="q-rcpt" data-act="qrcpt"></button><label class="btn small" for="q-cam">📷 拍收據</label><label class="btn small" for="q-pick">選照片</label>
      <input id="q-cam" type="file" accept="image/*" capture="environment" hidden><input id="q-pick" type="file" accept="image/*" hidden></div></div>
    <div id="q-photo-box"></div>
    ${!pre.cardKey && st.templates.length ? `<div class="chips qtpl">${st.templates.map((t, i) => `<button type="button" class="chip" data-act="qtpl" data-i="${i}">${esc(t.desc)} <span class="num">${fmt(t.amount)}</span></button>`).join('')}</div>` : ''}
    <form class="form" id="qform" autocomplete="off">
      <div class="qamt"><button type="button" class="qcur" id="q-cur" data-act="qcur" aria-label="切換幣別">NT$</button><input id="q-amt" name="amount" inputmode="decimal" placeholder="0" value="${pre.amount ?? ''}" aria-label="金額（可以打算式）" autocomplete="off"></div>
      <div class="qops">${[['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/'], ['(', '('], [')', ')'], ['⌫', 'del']].map(([l, v]) => `<button type="button" class="chip" data-act="qop" data-v="${v}" aria-label="${v === 'del' ? '刪一格' : l}">${l}</button>`).join('')}<span id="q-calc" class="num" hidden></span></div>
      <div id="q-fx" class="sub"></div>
      <div class="field"><input id="q-desc" name="desc" list="q-descs" placeholder="寫點什麼（例如：午餐 牛肉麵）" value="${esc(pre.desc || '')}" aria-label="描述"><datalist id="q-descs">${[...st.byDesc.keys()].slice(-200).reverse().map(d => `<option value="${esc(d)}">`).join('')}</datalist></div>
      <div id="q-cats"></div>
      <div class="fields2"><div class="field"><label for="q-date">日期</label><input id="q-date" name="date" type="date" value="${pre.date || todayISO()}"></div>
        <div class="field" id="q-acct-box" hidden><label for="q-acct-sel">其他帳戶</label><select id="q-acct-sel">${accountOptions(Q.account).map(a => `<option ${a === Q.account ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div></div>
      <details id="q-more"><summary>代墊／分攤</summary><div class="field" style="padding-top:8px"><label for="m-share">我負擔金額</label><input id="m-share" name="myShare" inputmode="decimal" placeholder="全部是我的就留空（可以只填下面每個人的金額）"></div>${whoEditor('q-who', [])}
        <div class="chips" data-gross-from="q-amt" style="padding-top:8px">${[['1/2', .5], ['1/3', 1 / 3], ['1/4', .25], ['2/4', .5]].map(([l, f]) => `<button type="button" class="chip" data-act="sharefrac" data-f="${f}">我出 ${l}</button>`).join('')}</div></details>
    </form>
    <div class="acts"><button class="btn" data-act="closesheet">取消</button>${pre.cardKey ? '' : '<button class="btn" data-act="qsave" data-again="1">記下並繼續</button>'}<button class="btn primary" data-act="qsave">記下來</button></div>`);
  renderQuickCats(); renderReceiptBtn();
  if (pre.einv) $('#q-photo-box').innerHTML = `<div class="facts"><b>載具發票 ${esc(pre.einv.inv.slice(0, 2))}-${esc(pre.einv.inv.slice(2))}・${esc(pre.einv.seller)}</b><span class="sub">${esc(pre.einv.address || '')}</span>${einvItemsText(pre.einv, 99) ? `<span class="sub">${esc(einvItemsText(pre.einv, 99))}</span>` : ''}</div>`;
  for (const id of ['#q-cam', '#q-pick']) $(id).addEventListener('change', e => { handleQuickPhoto(e.target.files[0]); e.target.value = ''; });
  const amt = $('#q-amt'); setTimeout(() => amt.focus(), 50);
  $('#q-desc').addEventListener('change', () => guessReceipt());
  $('#q-desc').addEventListener('change', e => { const hit = st.byDesc.get(e.target.value.trim()); if (hit) { if (!Q.main) { Q.main = hit.main; Q.sub = hit.sub; } if (!Q.touched && hit.account) Q.account = hit.account; if (!$('#q-amt').value) $('#q-amt').value = hit.gross ?? hit.amount; renderQuickCats(); } });
  $('#q-acct-sel').addEventListener('change', e => { Q.account = e.target.value; Q.touched = true; renderQuickCats(); });
  let ht; $('#q-amt').addEventListener('input', () => { renderFx(); clearTimeout(ht); ht = setTimeout(renderQuickCats, 250); });
  $('#q-date').addEventListener('change', e => { setQuickTrip(e.target.value, !!Q.cardKey); renderQuickCats(); });
  renderFx();
}
// ---------------------------------------------------------------- 旅行模式（記帳時用外幣、算進旅遊）
function setQuickTrip(date, isCard) {
  const t = S.config.trip;
  Q.tripSoon = !isCard && t && t.on && date < t.start && date >= E.util.addDays(t.start, -120) ? t : null; // 出發前買的也能算進這趟
  const on = !isCard && E.tripActive(t, date);
  if (on && !Q.trip) { Q.trip = t; Q.cur = t.cur || 'JPY'; Q.tripOff = false; if (!Q.touched && t.cashAccount) Q.account = Q.account; }
  if (!on && !(Q.trip && Q.tripSoon && Q.trip.id === Q.tripSoon.id)) { Q.trip = null; Q.cur = 'TWD'; }
  renderFx();
}
function tripOn() { return !!(Q.trip && !Q.tripOff); }
function renderFx() {
  const b = $('#q-cur'), box = $('#q-fx'); if (!b || !box) return;
  const foreign = Q.cur && Q.cur !== 'TWD';
  b.textContent = foreign ? ({ JPY: '¥', USD: 'US$', KRW: '₩', EUR: '€' }[Q.cur] || Q.cur) : 'NT$';
  b.classList.toggle('on', !!foreign); b.disabled = !Q.trip;
  const amt = amtOf$('#q-amt');
  const raw = ($('#q-amt') || {}).value || '', calcBox = $('#q-calc');
  if (calcBox) { const v = E.calcAmount(raw); calcBox.textContent = E.isFormula(raw) ? (isNaN(v) ? '算式看不懂，再檢查一下' : '= ' + fmt(v)) : ''; calcBox.hidden = !E.isFormula(raw); }
  box.textContent = foreign ? (amt ? `≈ NT$ ${fmt(Math.round(amt * Q.trip.rate))}（匯率 ${Q.trip.rate}）` : `輸入${Q.cur === 'JPY' ? '日幣' : Q.cur}金額，匯率 ${Q.trip.rate}`) : '';
  box.hidden = !foreign;
  const sl = document.querySelector('label[for="m-share"]'); if (sl) sl.textContent = foreign ? `我負擔金額（${Q.cur}）` : '我負擔金額';
}
function renderQuickCats() {
  const st = Q.st; const box = $('#q-cats'); if (!box) return;
  const subs = Q.main ? [...new Set([...subOptions(Q.main), ...[...st.byDesc.values()].filter(a => a.main === Q.main && a.sub).map(a => a.sub)])] : [];
  const accts = [...new Set([Q.account, ...(tripOn() && Q.trip.cashAccount ? [Q.trip.cashAccount] : []), ...st.accts])].filter(Boolean).slice(0, 6);
  const typeRow = `<div class="qrow"><span class="qlbl">類型</span><div class="chips">${[['Expense', '支出'], ['Income', tripOn() ? '收入／退稅' : '收入']].map(([v, l]) => `<button type="button" class="chip" data-act="qtype" data-v="${v}" aria-pressed="${Q.type === v}">${l}</button>`).join('')}</div></div>`;
  const acctRow = `<div class="qrow"><span class="qlbl">帳戶</span><div class="chips">${accts.map(m => `<button type="button" class="chip" data-act="qacct" data-v="${esc(m)}" aria-pressed="${Q.account === m}">${esc(m)}</button>`).join('')}<button type="button" class="chip" data-act="qacct" data-v="__other">其他…</button></div></div>`;
  if (Q.type === 'Income') {
    const isubs = [...new Set([...(tripOn() ? ['退稅退款'] : []), ...subOptions('收入'), ...[...st.byDesc.values()].filter(a => a.main === '收入' && a.sub).map(a => a.sub)])].slice(0, 10);
    box.innerHTML = `${typeRow}
    ${isubs.length ? `<div class="qrow"><span class="qlbl">細項</span><div class="chips">${isubs.map(m => `<button type="button" class="chip" data-act="qsub" data-v="${esc(m)}" aria-pressed="${Q.sub === m}">${esc(m)}</button>`).join('')}</div></div>` : ''}
    ${acctRow}${tripOn() ? `<div class="sub">退稅、退款記在這裡：會從「${esc(Q.trip.name || '旅行')}」的花費扣掉；帳戶選${esc(Q.trip.cashAccount || '現金')}的話也會加回現金餘額。</div>` : ''}`;
    return;
  }
  if (tripOn()) {
    box.innerHTML = `${typeRow}
    <div class="qrow"><span class="qlbl">${esc(Q.trip.name || '旅行')}</span><div class="chips">${E.TRIP_CATS.map(c => `<button type="button" class="chip" data-act="qtcat" data-v="${esc(c)}" aria-pressed="${Q.tripCat === c}">${esc(c)}</button>`).join('')}<button type="button" class="chip" data-act="qtoff">不算這趟旅行…</button></div></div>
    <div class="qrow"><span class="qlbl">帳戶</span><div class="chips">${accts.map(m => `<button type="button" class="chip" data-act="qacct" data-v="${esc(m)}" aria-pressed="${Q.account === m}">${esc(m)}</button>`).join('')}<button type="button" class="chip" data-act="qacct" data-v="__other">其他…</button></div></div>`;
    return;
  }
  box.innerHTML = `${typeRow}
    ${Q.trip ? `<div class="qrow"><span class="qlbl">旅行</span><div class="chips"><button type="button" class="chip" data-act="qtoff">改回算進${esc(Q.trip.name || '旅行')}</button></div></div>` : Q.tripSoon ? `<div class="qrow"><span class="qlbl">旅行</span><div class="chips"><button type="button" class="chip" data-act="qtripsoon">✈️ 算進${esc(Q.tripSoon.name || '旅行')}（出發前買的）</button></div></div>` : ''}
    <div class="qrow"><span class="qlbl">分類</span><div class="chips">${st.mains.map(m => `<button type="button" class="chip" data-act="qmain" data-v="${esc(m)}" aria-pressed="${Q.main === m}">${esc(m)}</button>`).join('')}</div></div>
    ${subs.length ? `<div class="qrow"><span class="qlbl">細項</span><div class="chips">${subs.map(m => `<button type="button" class="chip" data-act="qsub" data-v="${esc(m)}" aria-pressed="${Q.sub === m}">${esc(m)}</button>`).join('')}</div></div>` : ''}
    ${budgetHint() ? `<div class="qrow"><span class="qlbl">預算</span><div class="chips">${budgetHint()}</div></div>` : ''}
    <div class="qrow"><span class="qlbl">帳戶</span><div class="chips">${accts.map(m => `<button type="button" class="chip" data-act="qacct" data-v="${esc(m)}" aria-pressed="${Q.account === m}">${esc(m)}</button>`).join('')}<button type="button" class="chip" data-act="qacct" data-v="__other">其他…</button></div></div>`;
  guessReceipt();
}
function applyTemplate(i) {
  const t = Q.st.templates[i]; if (!t) return;
  $('#q-amt').value = t.amount; $('#q-desc').value = t.desc; Q.main = t.main; Q.sub = t.sub; Q.account = t.account; Q.touched = true; renderQuickCats();
}
function saveQuick(again) {
  const f = Object.fromEntries(new FormData($('#qform')));
  const amount = E.calcAmount(f.amount);
  if (amount == null || isNaN(amount) || !amount) { toast(isNaN(amount) ? '金額的算式看不懂，再檢查一下' : '先輸入金額'); $('#q-amt').focus(); return; }
  if (amount < 0) { toast('金額算出來是負的，再檢查一下'); return; }
  const trip = tripOn() && (Q.type === 'Expense' || Q.type === 'Income') ? Q.trip : null;
  if (trip && Q.type === 'Expense' && !Q.tripCat) { toast('選一個類別（餐飲、交通…）'); return; }
  if (trip && Q.type === 'Expense') { Q.main = '娛樂與個人享受'; Q.sub = '旅遊'; }
  if (Q.type === 'Expense' && !Q.main) { toast('選一個分類'); return; }
  const detail = (S.config.detailMap || []).find(d => d.main === Q.main && d.sub === Q.sub) || (S.config.detailMap || []).find(d => d.main === Q.main);
  let share = f.myShare === '' || f.myShare == null ? null : E.calcAmount(f.myShare);
  if (share != null && (isNaN(share) || share < 0 || share > amount)) { toast('我負擔金額要介於 0 和總金額之間'); return; }
  const foreign = Q.trip && Q.cur && Q.cur !== 'TWD' ? { cur: Q.cur, amt: amount, rate: +Q.trip.rate } : null;
  const twd = foreign ? Math.round(amount * foreign.rate) : amount;
  if (foreign && share != null) share = Math.round(share * foreign.rate);
  const who = readWho($('#q-who'), twd, share, foreign && foreign.rate, foreign ? v => Math.round(v * foreign.rate) : null);
  if (who.err) { toast(who.err); return; }
  share = who.myShare;
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const body = { id, date: f.date || todayISO(), amount: twd, desc: (f.desc || '').trim(), account: Q.account, txType: Q.type, life: Q.type === 'Expense' ? 1 : 0,
    main: Q.type === 'Expense' ? Q.main : (Q.main || '收入'), sub: Q.sub || null, essential: Q.type === 'Expense' ? (detail?.essential || null) : null, fixed: Q.type === 'Expense' ? (detail?.fixed || null) : null,
    myShare: share, splitWith: who.splitWith, splits: who.splits, cardKey: Q.cardKey || null, createdAt: new Date().toISOString(), via: 'quick' };
  if (foreign) body.fx = foreign;
  if (trip && Q.type === 'Expense') Object.assign(body, { trip: trip.id, tripCat: Q.tripCat, essential: '非必要', fixed: '變動' });
  if (trip && Q.type === 'Income') Object.assign(body, { trip: trip.id, tripCat: '退稅／退款', main: '收入', sub: Q.sub || '退稅退款' });
  if (!Q.sameOk && S.manual.some(m => m.date === body.date && +m.amount === +body.amount && (m.desc || '').trim() === body.desc)) { Q.sameOk = true; toast(`${body.date.slice(5).replace('-', '/')} 已經記過一筆「${body.desc || body.main} ${fmt(body.amount)}」，確定要再記一次就再按一次`); return; }
  const inv = Q.invoice;
  if (inv && !Q.dupOk && S.manual.some(m => m.inv === inv.inv)) { Q.dupOk = true; toast('這張發票已經記過了，確定要再記一次就再按一次'); return; }
  if (inv) Object.assign(body, { inv: inv.inv, seller: inv.seller, items: inv.items.slice(0, 40).map(i => [i.name, i.qty, i.price]), via: 'receipt' });
  if (Q.type === 'Expense') body.receipt = foreign ? 'none' : (Q.receipt || 'carrier');
  if (Q.photo && S.db.queuePhoto) { body.photo = `photos/${body.date.slice(0, 7)}/${id}.jpg`; if (!S.db.queuePhoto(body.photo, Q.photo.b64)) toast('手機空間不足，照片只暫存在這次開啟中，請保持網路連線'); }
  S.db.doc('manual/' + id).set(body).catch(() => {}); // queued on this device; syncs in the background
  toast(`已記下 ${body.desc || body.tripCat || body.main} ${foreign ? fmt(amount) + ' ' + foreign.cur + ' ≈ NT$ ' + fmt(twd) : fmt(amount)}${body.photo ? '（含照片）' : ''}`);
  if (again) { $('#q-amt').value = ''; $('#q-desc').value = ''; Q.main = null; Q.sub = null; Object.assign(Q, { photo: null, invoice: null, sellerHit: null, dupOk: false, sameOk: false, receipt: 'carrier', rcptTouched: false, tripCat: null }); renderFx(); renderPhotoBox(); renderQuickCats(); renderReceiptBtn(); $('#q-amt').focus(); }
  else closeSheet();
}

// ---------------------------------------------------------------- events
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
  if (t.dataset.tab) { goTab(t.dataset.tab); return; }
  if (Date.now() - (SW.done || 0) < 400 && t.closest('.swipe')) return; // 剛滑完，不當成點擊
  if (a0(t) === 'editrow') { const sw = t.closest('.swipe.open'); if (sw) { closeSwipe(sw); return; } }
  const a = t.dataset.act, d = t.dataset;
  if (a === 'closesheet') { if (e.target === t || t.tagName === 'BUTTON') closeSheet(); return; }
  const months = monthsAvailable();
  if (a === 'mprev' || a === 'mnext') { const i = months.indexOf(S.month) + (a === 'mprev' ? -1 : 1); if (months[i]) { S.month = months[i]; render(); } }
  else if (a === 'setmonth') { if (months.includes(d.m)) { S.month = d.m; render(); } }
  else if (a === 'flowyear') { S.flowYear = d.y; render(); }
  else if (a === 'catfilter') { S.filter = 'cat:' + d.cat; S.tab = 'list'; render(); }
  else if (a === 'filter') { S.filter = d.f; render(); }
  else if (a === 'editrow') sheetEditRow(d.key);
  else if (a === 'editbank') sheetEditBank(d.key);
  else if (a === 'saverow') saveRow(d.key);
  else if (a === 'savebank') saveBank(d.key);
  else if (a === 'resetrow') { if (await remove('ovr/' + d.id)) { closeSheet(); toast('已還原'); } }
  else if (a === 'addmanual' || a === 'quick') sheetQuick();
  else if (a === 'qtpl') applyTemplate(+d.i);
  else if (a === 'qmain') { Q.main = d.v; Q.sub = null; renderQuickCats(); }
  else if (a === 'qsub') { Q.sub = Q.sub === d.v ? null : d.v; renderQuickCats(); }
  else if (a === 'qacct') { if (d.v === '__other') { $('#q-acct-box').hidden = false; $('#q-acct-sel').focus(); } else { Q.account = d.v; renderQuickCats(); } }
  else if (a === 'qtype') { Q.type = d.v; Q.sub = d.v === 'Income' && tripOn() ? '退稅退款' : null; if (d.v === 'Income') Q.main = '收入'; else Q.main = null; renderQuickCats(); renderReceiptBtn(); }
  else if (a === 'qrcpt') { const R = E.RECEIPTS; Q.receipt = R[(R.indexOf(Q.receipt) + 1) % R.length]; Q.rcptTouched = true; renderReceiptBtn(); toast(RECEIPT_TIP[Q.receipt]); }
  else if (a === 'qsave') saveQuick(d.again === '1');
  else if (a === 'qop') {
    const inp = $('#q-amt'); if (!inp) return;
    if (d.v === 'del') inp.value = inp.value.slice(0, -1);
    else { const v = inp.value; inp.value = /[+\-*/]$/.test(v) && /[+\-*/]/.test(d.v) ? v.slice(0, -1) + d.v : v + d.v; }
    inp.dispatchEvent(new Event('input')); inp.focus({ preventScroll: true });
  }
  else if (a === 'qcur') { if (Q.trip) { Q.cur = Q.cur === 'TWD' ? (Q.trip.cur || 'JPY') : 'TWD'; renderFx(); renderReceiptBtn(); } }
  else if (a === 'qtcat') { Q.tripCat = Q.tripCat === d.v ? null : d.v; renderQuickCats(); }
  else if (a === 'qtripsoon') { if (Q.tripSoon) { Q.trip = Q.tripSoon; Q.tripOff = false; Q.cur = 'TWD'; renderFx(); renderQuickCats(); renderReceiptBtn(); } }
  else if (a === 'qtoff') { Q.tripOff = !Q.tripOff; renderQuickCats(); renderReceiptBtn(); }
  else if (a === 'tripedit') sheetTrip();
  else if (a === 'tripsave') saveTrip();
  else if (a === 'triprows') sheetTripRows();
  else if (a === 'toggledup') {
    const o = S.ovr.find(x => x.kind === 'app' && x.key === d.key);
    const body = { ...(o || { kind: 'app', key: d.key }), exclude: o && o.exclude ? null : '重複', updatedAt: new Date().toISOString() }; delete body._id;
    if (await write('ovr/' + hashId('a', d.key), body)) { closeSheet(); toast(body.exclude ? '已標記為重複，不再計入' : '已取消重複標記'); }
  }
  else if (a === 'copyrow') { document.querySelectorAll('.swipe.open').forEach(closeSwipe); copyRow(d.key); }
  else if (a === 'auditok') { if (await write('ovr/' + hashId('k', d.key), { kind: 'auditok', key: d.key, createdAt: new Date().toISOString() })) toast('好，這筆不會再列出來'); }
  else if (a === 'einvadd') einvQuick(d.inv);
  else if (a === 'einvign') { if (await write('ovr/' + hashId('e', d.inv), { kind: 'einv', inv: d.inv, action: 'ignore', createdAt: new Date().toISOString() })) toast('已忽略'); }
  else if (a === 'einvundo') { const o = S.ovr.find(x => x.kind === 'einv' && x.inv === d.inv); if (o && await remove('ovr/' + o._id)) toast('已還原'); }
  else if (a === 'einvlink') { if (await write('ovr/' + hashId('e', d.inv), { kind: 'einv', inv: d.inv, action: 'link', key: d.key, createdAt: new Date().toISOString() })) toast('已對上，帳上那筆會補上店名'); }
  else if (a === 'einvnot') { const o = S.ovr.find(x => x.kind === 'einv' && x.inv === d.inv); const keys = [...new Set([...(o && o.action === 'nosuggest' ? o.keys || [] : []), d.key])]; if (await write('ovr/' + hashId('e', d.inv), { kind: 'einv', inv: d.inv, action: 'nosuggest', keys, createdAt: new Date().toISOString() })) toast('好，這張改列帳上找不到'); }
  else if (a === 'qphotodel') { Object.assign(Q, { photo: null, invoice: null, sellerHit: null, rcptTouched: false }); renderPhotoBox(); guessReceipt(); }
  else if (a === 'viewphoto') sheetPhoto(d.path, d.local === '1');
  else if (a === 'savemanual') saveManual();
  else if (a === 'delmanual') { if (t.dataset.confirm) { const ph = (manualById(d.id) || {}).photo; if (await remove('manual/' + d.id)) { if (ph) S.db.deletePhoto(ph).catch(() => {}); closeSheet(); toast('已刪除'); } } else { t.dataset.confirm = '1'; t.textContent = '再按一次確認刪除'; } }
  else if (a === 'pairok' || a === 'pairset') { if (await write('ovr/' + hashId('p', d.a + '>' + d.c), { kind: 'cardmatch', appKey: d.a, cardKey: d.c, createdAt: new Date().toISOString() })) { closeSheet(); toast('已配對'); } }
  else if (a === 'pairpick') sheetPair(d.side, d.key, d.pre ? [d.pre] : null);
  else if (a === 'pairmulti') {
    const keys = [...document.querySelectorAll('#pairform input:checked')].map(i => i.value);
    if (!keys.length) { toast('至少選一筆 APP 紀錄'); return; }
    const adj = $('#pair-adjust'); const body = { kind: 'cardmatch', appKeys: keys, cardKey: d.c, adjust: !!(adj && adj.checked && !$('#adjbox').hidden), createdAt: new Date().toISOString() };
    if (await write('ovr/' + hashId('p', d.c), body)) { closeSheet(); toast(keys.length > 1 ? `已把 ${keys.length} 筆合併配對` : '已配對'); }
  }
  else if (a === 'unpair') { if (await remove('ovr/' + d.id)) toast('已取消配對，兩邊回到待處理'); }
  else if (a === 'pairall') {
    const sug = S.res.recon.filter(x => x.month === S.month && x.status === '需人工確認');
    const ok = await Promise.all(sug.map(x => write('ovr/' + hashId('p', x.card.key), { kind: 'cardmatch', appKeys: [x.app.key], cardKey: x.card.key, createdAt: new Date().toISOString() })));
    toast(`已確認 ${ok.filter(Boolean).length} 筆`);
  }
  else if (a === 'sharefrac') {
    const box = t.closest('.chips'); const gross = box.dataset.grossFrom ? amtOf$('#' + box.dataset.grossFrom) : +box.dataset.gross;
    const inp = $('#f-share') || $('#m-share'); if (inp && gross) inp.value = Math.round(gross * +d.f);
  }
  else if (a === 'settle') sheetSettle(d.key, d.w || null);
  else if (a === 'person') sheetPerson(d.n, d.ctx || null);
  else if (a === 'personall') {
    const g = E.peopleOwe(S.res.receivables, r => r.open > 0.5 && (!d.ctx || r.trip === d.ctx)).find(x => x.who === d.n); if (!g) return;
    const its = g.items.filter(i => i.open > 0.5);
    if (!confirmTwice(t, `再按一次確認：${d.n} 共 ${fmt(g.open)}（${its.length} 筆）全部標成已收回`)) return;
    const now = new Date().toISOString(); let ok = 0;
    for (const i of its) { const txKey = 'cash:' + Date.now().toString(36) + ok; if (await write('ovr/' + hashId('s', i.recv.key + '>' + d.n + '>' + txKey), { kind: 'settle', recvKey: i.recv.key, who: d.n, txKey, amount: Math.round(i.open * 100) / 100, createdAt: now }, true)) ok++; }
    closeSheet(); toast(`已記錄 ${d.n} 收回 ${ok} 筆`);
  }
  else if (a === 'whoadd') { const box = t.closest('.whofield').querySelector('.whobox'); box.insertAdjacentHTML('beforeend', whoRow()); box.lastElementChild.querySelector('.who-n').focus(); }
  else if (a === 'whodel') { const box = t.closest('.whobox'); t.closest('.whorow').remove(); if (!box.querySelector('.whorow')) box.insertAdjacentHTML('beforeend', whoRow()); }
  else if (a === 'whopick') {
    const box = t.closest('.whofield').querySelector('.whobox');
    if ([...box.querySelectorAll('.who-n')].some(i => E.whoName(i.value) === d.n)) return;
    const empty = [...box.querySelectorAll('.who-n')].find(i => !i.value.trim());
    if (empty) empty.value = d.n; else box.insertAdjacentHTML('beforeend', whoRow(d.n));
  }
  else if (a === 'settlepick' || a === 'settlecash') {
    const amt = +($('#st-amt').value || 0); if (!amt) { toast('請填收回金額'); return; }
    const txKey = a === 'settlecash' ? 'cash:' + Date.now().toString(36) : d.t;
    if (await write('ovr/' + hashId('s', d.r + '>' + (d.w || '') + '>' + txKey), { kind: 'settle', recvKey: d.r, txKey, amount: amt, who: d.w || null, createdAt: new Date().toISOString() })) { closeSheet(); toast('已記錄收回'); }
  }
  else if (a === 'ignore') { if (await write('ovr/' + hashId('i', d.key), { kind: 'cardignore', key: d.key, createdAt: new Date().toISOString() })) { closeSheet(); toast('已忽略'); } }
  else if (a === 'cardadd') { const c = S.res.card.find(x => x.key === d.key); if (c) sheetQuick({ date: c.date, amount: c.amount, desc: c.merchant, account: S.config.cardAccount || '玉山 unicard', cardKey: c.key }); }
  else if (a === 'nwfill') { const s = nwSuggest(S.month); for (const [k] of NW_FIELDS) { if (k === 'h' || s[k] == null) continue; const el = document.getElementById('nw-' + k); if (el && el.value === '') el.value = Math.round(s[k]); } toast('已帶入空白欄位的建議值'); }
  else if (a === 'nwsave') {
    const f = Object.fromEntries(new FormData($('#nwform'))); const body = { status: f.status, updatedAt: new Date().toISOString() };
    for (const [k] of NW_FIELDS) { if (k === 'h') continue; const v = String(f[k] || '').replace(/,/g, '').trim(); if (v !== '' && !isNaN(+v)) body[k] = LIAB.includes(k) ? -Math.abs(+v) : +v; }
    if (await write('nw/' + S.month, body)) toast('快照已儲存');
  }
  else if (a === 'debtedit') sheetDebt(+d.i);
  else if (a === 'debtsave') saveDebt(+d.i, false);
  else if (a === 'debtdel') { if (t.dataset.confirm) saveDebt(+d.i, true); else { t.dataset.confirm = '1'; t.textContent = '再按一次確認刪除'; } }
  else if (a === 'ghsave') {
    const f = Object.fromEntries(new FormData($('#ghform')));
    const cfg = { owner: f.owner.trim(), repo: f.repo.trim(), token: f.token.trim() || (ghSettings() || {}).token };
    if (!cfg.owner || !cfg.repo || !cfg.token) { toast('三個欄位都要填'); return; }
    t.disabled = true; t.textContent = '連線中…';
    try { await new window.GitStore(cfg).checkAccess(); try { localStorage.setItem(GH_KEY, JSON.stringify(cfg)); } catch (_) { toast('瀏覽器不允許儲存設定'); return; } location.reload(); }
    catch (err) { renderSetup(err.message); }
  }
  else if (a === 'ghlogout') { if (t.dataset.confirm) { try { localStorage.removeItem(GH_KEY); for (const k of Object.keys(localStorage)) if (k.startsWith('fin.c.')) localStorage.removeItem(k); } catch (_) {} location.reload(); } else { t.dataset.confirm = '1'; t.textContent = '確認登出？（資料仍在 GitHub）'; } }
  else if (a === 'syncnow') { await S.db.retry(); await S.db.refresh(); toast('已同步'); }
  else if (a === 'backup') {
    const blob = new Blob([JSON.stringify({ app: 'finance-ledger', exportedAt: new Date().toISOString(), docs: S.db.exportAll() })], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url; el.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  else if (a === 'catadd') {
    const f = Object.fromEntries(new FormData($('#catform'))); const sub = (f.sub || '').trim();
    if (!sub) { toast('請輸入細項名稱'); return; }
    const dm = [...(S.config.detailMap || [])];
    if (dm.some(d => d.main === f.main && d.sub === sub)) { toast('這個細項已經有了'); return; }
    dm.push({ main: f.main, sub, essential: f.essential, fixed: f.fixed, custom: true });
    try { await S.db.doc('config/main').update({ detailMap: dm }); toast(`已新增「${f.main}・${sub}」`); } catch (err) { toast('儲存失敗：' + err.message); }
  }
  else if (a === 'catdel') {
    const used = S.res.app.some(r => r.main === d.main && r.sub === d.sub);
    if (used && !t.dataset.confirm) { t.dataset.confirm = '1'; toast('已有紀錄用這個細項，再按一次 ✕ 仍會刪除（舊紀錄保留原本的細項名稱）'); return; }
    const dm = (S.config.detailMap || []).filter(x => !(x.custom && x.main === d.main && x.sub === d.sub));
    try { await S.db.doc('config/main').update({ detailMap: dm }); toast('已刪除'); } catch (err) { toast('儲存失敗：' + err.message); }
  }
  else if (a === 'cashgap') {
    const m = S.month; const last = new Date(+m.slice(0, 4), +m.slice(5), 0).getDate();
    const id = 'm' + Date.now().toString(36) + 'cash';
    S.db.doc('manual/' + id).set({ id, date: `${m}-${String(last).padStart(2, '0')}`, amount: +d.amt, desc: '現金差額（錢包盤點）', account: '現金', txType: 'Expense', life: 1, main: '現金差額', sub: '未記帳現金', essential: '非必要', fixed: '變動', createdAt: new Date().toISOString(), via: 'cashcheck' }).catch(() => {});
    toast(`已把 ${fmt(+d.amt)} 記成現金差額`);
  }
  else if (a === 'pjsave') {
    const f = Object.fromEntries(new FormData($('#pjform'))); const n = v => { const x = String(v || '').replace(/,/g, '').trim(); return x === '' || isNaN(+x) ? null : +x; };
    try { await S.db.doc('config/main').update({ projection: { bonus: n(f.bonus), monthlyIncome: n(f.monthlyIncome) } }); toast('已更新年度預估'); } catch (err) { toast('儲存失敗：' + err.message); }
  }
  else if (a === 'budgetedit') sheetBudget();
  else if (a === 'budgetlist') { S.filter = 'budget:' + d.i; S.tab = 'list'; render(); }
  else if (a === 'budgetadd') { const box = $('#budgetrows'); const i = box.children.length; box.insertAdjacentHTML('beforeend', S.budgetRow({}, i)); }
  else if (a === 'budgetrm') { t.closest('[data-row]').remove(); }
  else if (a === 'budgetsave') {
    const budgets = readBudgetRows(); const num = id => +String(($(id) || {}).value || '').replace(/,/g, '') || 0;
    const daily = num('#mp-daily'), extra = num('#mp-extra'), allowanceSub = (($('#mp-allow') || {}).value || '').trim() || '青穎餐費';
    const mealPlan = daily > 0 ? { ...(S.config.mealPlan || {}), daily, extra, allowanceSub, allowanceKeywords: [allowanceSub] } : null;
    try { await S.db.doc('config/main').update({ budgets, mealPlan }); closeSheet(); toast('預算已儲存'); } catch (err) { toast('儲存失敗：' + err.message); }
  }
  else if (a === 'mealdays') sheetMealDays();
  else if (a === 'stocksync') syncStockLedger(true);
  else if (a === 'impcancel') { S.import = null; render(); }
  else if (a === 'impgo') runImport();
  else if (a === 'delraw') { if (t.dataset.confirm) { if (await remove('raw/' + d.id)) toast('已刪除'); } else { t.dataset.confirm = '1'; t.textContent = '確認刪除？'; } }
  else if (a === 'delovr') { if (await remove('ovr/' + d.id)) toast('已移除規則'); }
});
document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.other) { const o = document.getElementById(e.target.dataset.other); if (o) { o.hidden = e.target.value !== '__other'; if (!o.hidden) o.focus(); } }
  if (e.target.id === 'month-select') { S.month = e.target.value; render(); }
  if (e.target.id === 'restore-file' && e.target.files[0]) restoreBackup(e.target.files[0]);
  if (e.target.id === 'pick-dir' || e.target.id === 'pick-files') { if (e.target.files.length) handleFiles(e.target.files); }
  if (e.target.id === 'einv-file') { if (e.target.files[0]) importEinvoiceFile(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('input', e => { if (e.target.id === 'list-search') { S.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#list-search'); el.focus(); el.setSelectionRange(pos, pos); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); } });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update();
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || S.reloading) return; S.reloading = true; toast('已更新到新版，重新載入中…'); setTimeout(() => location.reload(), 900); });
  }).catch(() => {});
}
boot();
})();
