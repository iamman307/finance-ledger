
(function () {
'use strict';
const E = window.FinEngine;
const S = { db: null, loaded: { raw: false, cfg: false, ovr: false, manual: false, nw: false }, raw: [], config: null, ovr: [], manual: [], nw: {}, res: null,
  month: null, tab: 'home', q: '', filter: 'all', import: null, flowYear: null };
try { const t = localStorage.getItem('fin.tab'); if (t) S.tab = t; } catch (e) {}

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
  return [...set].filter(Boolean).sort();
}
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
  };
  try { await store.checkAccess(); await store.load(); }
  catch (e) {
    if (e.code === 'unauthenticated' || e.code === 'not_found' || e.code === 'public_repo' || e.code === 'forbidden') { renderSetup(e.message); return; }
    const n = store.loadFromCache();
    store.setStatus('offline', e.message);
    if (!n) { $('#view').innerHTML = `<div class="panel empty"><b>連不上 GitHub</b><span class="sub">${esc(e.message)}</span><button class="btn" onclick="location.reload()">重試</button></div>`; return; }
  }
  const docs = s => s.docs.map(d => ({ _id: d.id, ...d.data() }));
  store.collection('raw').onSnapshot(s => { S.raw = docs(s); S.loaded.raw = true; changed(); });
  store.doc('config/main').onSnapshot(s => { S.config = s.exists ? s.data() : null; S.loaded.cfg = true; changed(); });
  store.collection('ovr').onSnapshot(s => { S.ovr = docs(s); S.loaded.ovr = true; changed(); });
  store.collection('manual').onSnapshot(s => { S.manual = docs(s); S.loaded.manual = true; changed(); });
  store.collection('nw').onSnapshot(s => { S.nw = Object.fromEntries(docs(s).map(d => [d._id, d])); S.loaded.nw = true; changed(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.refresh(); });
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
  pend = requestAnimationFrame(() => { recompute(); render(); $('#sync').textContent = `${S.raw.length} 個原始檔 · ${STATUS_ZH[S.syncState] || '已同步'}`; });
}
async function write(path, data) {
  try { await S.db.doc(path).set(data); return true; }
  catch (e) { toast('儲存失敗：' + (e.message || e.code)); return false; }
}
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
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><h1 class="view">${y} 年收支</h1>
    <div class="chips">${years.map(yy => `<button class="chip" data-act="flowyear" data-y="${yy}" aria-pressed="${yy === y}">${yy}</button>`).join('')}</div></div>
  <div class="tablebox"><table class="ledger">
    <thead><tr><th>項目</th>${months.map(m => `<th class="${m === S.month ? 'cur' : ''}"><button class="linkbtn" style="color:inherit" data-act="setmonth" data-m="${m}">${+m.slice(5)}月</button></th>`).join('')}<th>YTD</th><th>月平均</th></tr></thead>
    <tbody>
      ${row('收入', s => s.income, 'total')}
      ${row('生活消費', s => s.expense, 'total')}
      ${cats.map(c => row('　' + c, s => s.cats[c])).join('')}
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
  const bexp = r.bank.filter(b => b.expMatch === '需人工確認' && b.date.slice(0, 7) === m);
  const appIss = r.issues.filter(i => ['APP資料異常', '未分類帳本', '設定錯誤', '未分類明細'].includes(i.type) && i.month === m);
  const bankRow = b => `<button type="button" class="row" data-act="editbank" data-key="${esc(b.key)}"><span><span class="t">${esc(b.desc)} ${esc(b.cp || b.note || '')}</span><span class="m"><span>${b.date}</span><span>${esc(b.account)}${b.acctNo ? '・' + esc(b.acctNo.slice(-4)) : ''}</span>${b.msg ? `<span>留言：${esc(b.msg)}</span>` : ''}</span></span><span class="a ${b.amount > 0 ? 'pos' : ''}">${sgn(b.amount)}</span></button>`;
  const side = (k, o, isCard) => o ? `<div class="side"><span class="k">${k}</span><span>${esc(isCard ? o.merchant : (o.desc || o.bill || ''))}</span><span class="sub num">${o.date}・${fmt(o.amount)}${isCard ? '' : '・' + esc(o.bill || '')}</span></div>` : `<div class="side"><span class="k">${k}</span><span class="sub">（沒有對應）</span></div>`;
  return `<h1 class="view">${mLabel(m)} 對帳</h1>
  <section class="panel"><header><h2>銀行待分類</h2><span class="pill ${pend.length ? 'bad' : 'ok'}">${pend.length ? pend.length + ' 筆，會擋月結' : '全部已分類'}</span></header>
    ${pend.length ? `<div class="list">${pend.map(bankRow).join('')}</div>` : '<div class="sub">銀行明細都已經有分類規則。</div>'}
    ${hist.length ? `<details><summary>BANK 啟用前的歷史待分類（${hist.length} 筆，不影響報表）</summary><div class="list">${hist.map(bankRow).join('')}</div></details>` : ''}
  </section>
  <section class="panel"><header><h2>信用卡對帳</h2><span class="sub">成功 ${matched} 筆${ignored ? `・已忽略 ${ignored}` : ''}</span></header>
    ${!st.card ? `<div class="callout">還沒有 ${mLabel(m)} 的玉山信用卡帳單。帳單寄來後到「匯入」選擇 xlsx 檔。</div>` : ''}
    ${sug.length ? `<div><b>金額相同但有多個候選（${sug.length}）</b><div class="sub">系統依日期最接近先幫你配好，確認就好。</div>
      ${sug.map(x => `<div class="pair">${side('APP', x.app)}${side('信用卡', x.card, true)}<div class="acts"><button class="btn small primary" data-act="pairok" data-a="${esc(x.app.key)}" data-c="${esc(x.card.key)}">確認是同一筆</button><button class="btn small" data-act="pairpick" data-side="app" data-key="${esc(x.app.key)}">改配其他筆</button></div></div>`).join('')}</div>` : ''}
    ${appOnly.length ? `<div><b>APP 有、信用卡沒有（${appOnly.length}）</b><div class="sub">可能是金額記錯、記錯帳戶，或是上一期帳單的消費。</div>
      ${appOnly.map(x => `<div class="pair">${side('APP', x.app)}<div class="side" style="align-content:center"><button class="btn small" data-act="pairpick" data-side="app" data-key="${esc(x.app.key)}">找對應的刷卡</button></div></div>`).join('')}</div>` : ''}
    ${cardOnly.length ? `<div><b>信用卡有、APP 沒有（${cardOnly.length}）</b><div class="sub">漏記的消費請到「明細」補記；手續費、折抵可直接忽略。</div>
      ${cardOnly.map(x => `<div class="pair">${side('信用卡', x.card, true)}<div class="side" style="align-content:center;display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-act="pairpick" data-side="card" data-key="${esc(x.card.key)}">找 APP 紀錄</button><button class="btn small" data-act="cardadd" data-key="${esc(x.card.key)}">補記</button><button class="btn small" data-act="ignore" data-key="${esc(x.card.key)}">忽略</button></div></div>`).join('')}</div>` : ''}
    ${st.card && !sug.length && !appOnly.length && !cardOnly.length ? '<div class="sub">這個月的信用卡都對上了。</div>' : ''}
  </section>
  ${bexp.length ? `<section class="panel"><header><h2>銀行支出待確認</h2><span class="pill warn">${bexp.length}</span></header><div class="sub">銀行有一筆支出，APP 有多筆同金額的紀錄，系統沒有自動補進總帳。若 APP 已記過就不用處理。</div><div class="list">${bexp.map(bankRow).join('')}</div></section>` : ''}
  ${appIss.length ? `<section class="panel"><header><h2>APP 資料檢查</h2><span class="pill warn">${appIss.length}</span></header><div class="list">${appIss.map(i => `<div class="row" style="cursor:default"><span><span class="t">${esc(i.type)}</span><span class="m">${esc(i.text)}${i.file ? '・' + esc(i.file) : ''}</span></span><span></span></div>`).join('')}</div></section>` : ''}`;
}

// ---------------------------------------------------------------- LIST
function viewList() {
  const m = S.month, q = S.q.trim().toLowerCase();
  let rows = S.res.ledger.filter(r => r.month === m);
  const F = { all: () => true, life: r => r.type === 'Expense' && r.life === 1, income: r => r.type === 'Income', other: r => !(r.type === 'Expense' && r.life === 1) && r.type !== 'Income' };
  if (S.filter.startsWith('cat:')) { const c = S.filter.slice(4); rows = rows.filter(r => r.type === 'Expense' && r.life === 1 && (c === '未分類' ? !r.main : r.main === c)); }
  else rows = rows.filter(F[S.filter] || F.all);
  if (q) rows = rows.filter(r => [r.desc, r.bill, r.main, r.sub, r.account, r.book, String(r.amount)].join(' ').toLowerCase().includes(q));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const groups = {}; for (const r of rows) (groups[r.date] ||= []).push(r);
  const total = rows.reduce((s, r) => s + (r.type === 'Income' ? 0 : r.type === 'Expense' && r.life ? r.amount : 0), 0);
  const chips = [['all', '全部'], ['life', '生活消費'], ['income', '收入'], ['other', '轉帳・投資・負債']];
  const wd = d => '日一二三四五六'[new Date(d + 'T00:00:00').getDay()];
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><h1 class="view">${mLabel(m)} 明細</h1><button class="btn primary" data-act="addmanual">＋ 記一筆</button></div>
  <div class="toolbar"><input class="search" id="list-search" type="search" placeholder="搜尋描述、分類、金額" value="${esc(S.q)}" aria-label="搜尋明細">
    <div class="chips">${chips.map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}${S.filter.startsWith('cat:') ? `<button class="chip" aria-pressed="true" data-act="filter" data-f="all">${esc(S.filter.slice(4))} ✕</button>` : ''}</div></div>
  <section class="panel" style="padding-top:4px"><div class="sub" style="padding-top:10px">${rows.length} 筆・其中生活消費 <span class="num">${fmt(total)}</span></div>
  <div class="list">${Object.entries(groups).map(([d, rs]) => `<div class="dayhead"><span>${+d.slice(5, 7)}/${+d.slice(8)}（${wd(d)}）</span></div>${rs.map(r => {
    const isLife = r.type === 'Expense' && r.life === 1;
    return `<button type="button" class="row" data-act="editrow" data-key="${esc(r.key)}"><span><span class="t">${esc(r.desc || r.bill || r.main || '')}</span><span class="m">${r.main ? `<span class="pill ${isLife ? 'mute' : 'acc'}">${esc(r.main)}${r.sub ? '・' + esc(r.sub) : ''}</span>` : `<span class="pill ${isLife ? 'warn' : 'mute'}">${isLife ? '未分類' : TYPE_ZH[r.type] || r.type}</span>`}${!isLife && r.main ? `<span>${TYPE_ZH[r.type] || r.type}</span>` : ''}<span>${esc(r.account || '')}</span>${r.src !== 'APP' ? `<span>${r.src === 'BANK' ? '銀行' : '手動'}</span>` : ''}${r.edited ? '<span>已修改</span>' : ''}</span></span><span class="a ${r.type === 'Income' ? 'pos' : ''}">${r.type === 'Income' ? '+' : ''}${fmt(r.amount)}</span></button>`;
  }).join('')}`).join('') || '<div class="empty sub">沒有符合的紀錄。</div>'}</div></section>`;
}

// ---------------------------------------------------------------- ASSETS
const NW_FIELDS = [
  ['h', '現金與存款'], ['兆豐', '兆豐（薪轉＋數位帳戶）'], ['玉山', '玉山存款'], ['現金', '現金'], ['還款專戶-將來', '還款專戶（將來）'], ['緊急預備金', '緊急預備金／定存'],
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
    _hint: { 兆豐: bal['兆豐'] ? bal['兆豐'].parts.map(p => `…${p.acctNo.slice(-4)} ${fmt(p.bal)}（${p.date}）`).join('＋') : '', 玉山: bal['玉山'] ? `最後餘額 ${bal['玉山'].parts[0].date}` : '',
      長期投資: inv ? `Stock Ledger ${String(inv.asOf || '').slice(0, 10)} 市值` : '', 波段投資: inv ? `含 Binance ${fmt(inv.external.reduce((a, h) => a + h.mvTwd, 0))}；券商交割現金在兆豐數位帳戶，不重複計` : '',
      信貸: '依利率與已繳期數推算', '0%分期': '依分期表推算', 信用卡未繳: stmt ? `${stmt.file} 本期應繳` : '' },
  };
}
function viewAssets() {
  const m = S.month, n = S.nw[m] || {}, sug = nwSuggest(m), t = nwTotals(n);
  const inv = E.latestInvest(S.raw);
  const debts = S.config.debts || [];
  const hist = Object.values(S.nw).filter(x => x._id <= m).sort((a, b) => a._id.localeCompare(b._id));
  return `<h1 class="view">${mLabel(m)} 資產負債</h1>
  <div class="kpis">
    <div class="kpi"><span class="lbl">總資產</span><span class="val">${fmt(t.assets)}</span></div>
    <div class="kpi"><span class="lbl">總負債</span><span class="val negv">${fmt(-t.liab)}</span></div>
    <div class="kpi"><span class="lbl">Net Worth</span><span class="val ${t.net < 0 ? 'negv' : ''}">${fmt(t.net)}</span><span class="note">${S.nw[m] ? esc(n.status || '暫估') : '尚未填寫'}</span></div>
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
  <section class="panel"><header><h2>分期與貸款</h2><button class="btn small" data-act="debtedit" data-i="-1">＋ 新增</button></header>
    <div class="list">${debts.map((d, i) => { const s = E.debtStatus(d, m); return `<button type="button" class="row" data-act="debtedit" data-i="${i}"><span><span class="t">${esc(d.name)}</span><span class="m"><span class="pill ${s.status === '進行中' ? 'acc' : 'mute'}">${s.status}</span><span>${esc(d.type || '')}</span><span>月付 ${fmt(Math.round(s.payment || 0))}</span><span>${s.paid}/${d.n || '?'} 期</span></span></span><span class="a">${fmt(s.balance)}</span></button>`; }).join('')}</div>
  </section>
  <section class="panel"><header><h2>投資部位</h2><span class="sub">${inv ? esc(inv.file) : '尚未匯入'}</span></header>
    ${inv ? `<div class="list">${inv.holdings.sort((a, b) => b.mvTwd - a.mvTwd).map(h => `<div class="row" style="cursor:default"><span><span class="t">${esc(h.ticker)} <span class="sub">${esc(h.account)}</span></span><span class="m">${fmt(h.qty, 4)} 股・成本 ${fmt(h.costTwd)}</span></span><span class="a">${fmt(h.mvTwd)}<br><span class="sub ${h.mvTwd - h.costTwd < 0 ? 'negv' : 'pos'}">${sgn(h.mvTwd - h.costTwd)}</span></span></div>`).join('')}
      ${inv.external.map(h => `<div class="row" style="cursor:default"><span><span class="t">${esc(h.ticker)} <span class="sub">${esc(h.venue || '')}</span></span><span class="m">${esc(String(h.asOf || '').slice(0, 10))}</span></span><span class="a">${fmt(h.mvTwd)}</span></div>`).join('')}</div>
      ${inv.brokerCashTwd != null ? `<div class="sub">券商交割帳戶現金 ${fmt(inv.brokerCashTwd)}（＝兆豐數位帳戶，已含在兆豐存款）</div>` : ''}` : '<div class="sub">到「匯入」選擇 Stock Ledger 匯出的 JSON。</div>'}
  </section>
  ${hist.length > 1 ? `<section class="panel"><header><h2>Net Worth 走勢</h2></header><div class="list">${hist.map(x => `<div class="row" style="cursor:default"><span>${mLabel(x._id)} <span class="sub">${esc(x.status || '')}</span></span><span class="a">${fmt(nwTotals(x).net)}</span></div>`).join('')}</div></section>` : ''}
  </div></div>`;
}

// ---------------------------------------------------------------- DATA / IMPORT
function viewData() {
  S.raw = S.raw || [];
  const by = {}; for (const f of S.raw) (by[f.kind] ||= []).push(f);
  const KZ = { app: '記帳 APP', bank: '銀行存款', card: '玉山信用卡', invest: '投資 JSON' };
  const imp = S.import;
  const cp = S.ovr.filter(o => o.kind === 'cprule');
  return `<h1 class="view">匯入資料</h1>
  <section class="panel"><header><h2>月底匯入</h2><span class="sub">在電腦上操作</span></header>
    <div class="drop" id="drop">
      <b>選擇 D:\\Finance 資料夾</b>
      <span class="sub">會自動找出 APP_RAW、BANK_RAW、CARD_RAW、INVEST_RAW 裡的檔案；沒變的檔案會略過。也可以只挑幾個檔案。</span>
      <div class="toolbar" style="justify-content:center"><label class="btn primary" for="pick-dir">選擇資料夾</label><label class="btn" for="pick-files">選擇檔案</label></div>
      <input id="pick-dir" type="file" webkitdirectory directory multiple hidden><input id="pick-files" type="file" multiple accept=".xlsx,.xls,.json" hidden>
    </div>
    ${imp ? importPanel(imp) : ''}
    <details><summary>檔名規則</summary><div class="sub" style="padding-top:6px;display:grid;gap:4px">
      <span>記帳 APP：<span class="mono">YYYY-MM_帳本.xlsx</span>（例：2026-10_餐飲.xlsx）</span>
      <span>兆豐：<span class="mono">YYYY-MM_兆豐.xlsx</span> 或 <span class="mono">YYYY-MM_兆豐_薪轉.xlsx</span></span>
      <span>玉山存款：<span class="mono">YYYY-MM_玉山.xlsx</span>，有密碼的檔案要先移除密碼</span>
      <span>玉山信用卡：<span class="mono">YYYY-MM_玉山unicard.xlsx</span>（月份＝帳單月份）</span>
      <span>投資：Stock Ledger 匯出的 <span class="mono">stock-ledger-YYYY-MM-DD.json</span>，以最新一份為準</span>
    </div></details>
  </section>
  <section class="panel"><header><h2>已匯入的原始檔</h2><span class="sub">${S.raw.length} 檔</span></header>
    ${Object.entries(KZ).map(([k, l]) => by[k] ? `<details ${k === 'invest' ? 'open' : ''}><summary>${l}（${by[k].length}）</summary><div class="filelist">${by[k].sort((a, b) => b.file.localeCompare(a.file)).map(f => `<div class="f"><span>${esc(f.file)}${f.legacy ? ' <span class="pill mute">V2 舊 PDF</span>' : ''}</span><span class="sub num">${f.rows ? f.rows.length + ' 筆' : f.holdings ? f.holdings.length + ' 檔持股' : ''} <button class="linkbtn" style="color:var(--neg);margin-left:8px" data-act="delraw" data-id="${esc(f._id)}">刪除</button></span></div>`).join('')}</div></details>` : '').join('')}
  </section>
  <section class="panel"><header><h2>同步與備份</h2><span class="pill ${S.syncState === 'synced' ? 'ok' : S.syncState === 'error' ? 'bad' : 'warn'}">${STATUS_ZH[S.syncState] || '—'}</span></header>
    <div class="sub">資料 repo：<span class="mono">${esc((ghSettings() || {}).owner || '')}/${esc((ghSettings() || {}).repo || '')}</span>${S.syncDetail && S.syncState !== 'synced' ? '・' + esc(S.syncDetail) : ''}</div>
    <div class="toolbar"><button class="btn small" data-act="syncnow">立即同步</button><button class="btn small" data-act="backup">下載完整備份 JSON</button><label class="btn small" for="restore-file">從備份還原</label><input id="restore-file" type="file" accept=".json" hidden><button class="btn small danger" data-act="ghlogout">這台裝置登出</button></div>
  </section>
  ${cp.length ? `<section class="panel"><header><h2>你新增的對手方規則</h2></header><div class="list">${cp.map(o => `<div class="row" style="cursor:default"><span><span class="t">${esc(o.name || o.cp)}</span><span class="m mono">${esc(o.cp)}・${TYPE_ZH[o.txType] || o.txType}</span></span><button class="linkbtn" style="color:var(--neg)" data-act="delovr" data-id="${esc(o._id)}">移除</button></div>`).join('')}</div></section>` : ''}`;
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
  try { await loadXLSX(); } catch (e) { toast(e.message); S.import = null; render(); return; }
  const byId = new Map(S.raw.map(f => [f._id, f]));
  const items = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const kind = E.detectKind(path);
    if (!kind) { if (/\.(xlsx?|json|pdf)$/i.test(file.name) && !/^~\$/.test(file.name)) items.push({ name: file.name, state: '略過', err: /\.pdf$/i.test(file.name) ? 'PDF 帳單已改用 xlsx，舊 PDF 資料已搬進帳簿' : '不在 APP_RAW / BANK_RAW / CARD_RAW / INVEST_RAW 資料夾裡，或檔名不符規則' }); continue; }
    try {
      let doc;
      if (kind === 'invest') doc = E.parseInvest(file.name, JSON.parse(await file.text()));
      else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheets = wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })]);
        if (kind === 'app') doc = E.parseApp(file.name, (sheets.find(s => s[0] === 'Sheet1') || sheets[0])[1]);
        else if (kind === 'bank-mega') doc = E.parseBankMega(file.name, sheets);
        else if (kind === 'bank-esun') doc = E.parseBankEsun(file.name, sheets);
        else if (kind === 'card-esun') doc = E.parseCardEsun(file.name, sheets);
      }
      const id = E.fileDocId(doc.kind, file.name);
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
const TX = [['Expense', '支出'], ['Income', '收入'], ['Transfer', '轉帳（自己的錢換位置）'], ['Investment', '投資'], ['Debt', '負債（借款／還本金）'], ['Adjustment', '調整']];

function sheetEditRow(key) {
  const r = S.res.ledger.find(x => x.key === key) || S.res.app.find(x => x.key === key);
  if (!r) return;
  if (r.src === 'BANK' && r.type !== 'Expense') return sheetEditBank(key);
  const o = S.ovr.find(x => x.kind === 'app' && x.key === key);
  const isManual = r.src === 'MANUAL';
  openSheet(`<h3>${isManual ? '編輯手動紀錄' : '修改分類'}</h3>
    <div class="facts"><span><b>${esc(r.desc || r.bill || '')}</b></span><span class="num">${r.date}・${fmt(r.amount)}・${esc(r.account || '')}</span><span class="sub">來源：${r.src === 'APP' ? 'APP ' + esc(r.file) + '・帳單「' + esc(r.bill || '') + '」' : r.src === 'BANK' ? '銀行明細（APP 沒有記的支出）' : '手動新增'}</span></div>
    <form class="form" id="rowform">
      ${isManual ? `<div class="fields2"><div class="field"><label for="f-date">日期</label><input id="f-date" name="date" type="date" value="${r.date}"></div><div class="field"><label for="f-amt">金額</label><input id="f-amt" name="amount" inputmode="decimal" value="${r.amount}"></div></div><div class="field"><label for="f-desc">描述</label><input id="f-desc" name="desc" value="${esc(r.desc || '')}"></div><div class="field"><label for="f-acct">帳戶</label><input id="f-acct" name="account" value="${esc(r.account || '')}"></div>` : ''}
      <div class="fields2"><div class="field"><label for="f-type">交易類型</label><select id="f-type" name="txType" ${r.src === 'BANK' ? 'disabled' : ''}>${opt(TX, r.type)}</select></div>
      <div class="field"><label for="f-life">算生活消費</label><select id="f-life" name="life">${opt([['1', '是'], ['0', '否']], String(r.life))}</select></div></div>
      <div class="fields2"><div class="field"><label for="f-main">主分類</label><select id="f-main" name="main"><option value="">（未分類）</option>${opt(mainOptions(), r.main || '')}</select></div>
      <div class="field"><label for="f-sub">次分類</label><input id="f-sub" name="sub" list="sublist" value="${esc(r.sub || '')}"><datalist id="sublist">${subOptions(r.main).map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
      <div class="fields2"><div class="field"><label for="f-ess">必要性</label><select id="f-ess" name="essential">${opt([['', '—'], ['必要', '必要'], ['非必要', '非必要']], r.essential || '')}</select></div>
      <div class="field"><label for="f-fix">固定／變動</label><select id="f-fix" name="fixed">${opt([['', '—'], ['固定', '固定'], ['變動', '變動']], r.fixed || '')}</select></div></div>
    </form>
    <div class="acts">${isManual ? `<button class="btn danger" data-act="delmanual" data-id="${esc(r.manualId)}">刪除</button>` : o ? `<button class="btn" data-act="resetrow" data-id="${esc(o._id)}">還原成規則分類</button>` : ''}<button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="saverow" data-key="${esc(key)}">儲存</button></div>`);
  $('#f-main').addEventListener('change', e => { $('#sublist').innerHTML = subOptions(e.target.value).map(s => `<option value="${esc(s)}">`).join(''); const d = (S.config.detailMap || []).find(x => x.main === e.target.value); if (d && !$('#f-ess').value) $('#f-ess').value = d.essential || ''; });
}
async function saveRow(key) {
  const f = Object.fromEntries(new FormData($('#rowform')));
  const r = S.res.ledger.find(x => x.key === key) || S.res.app.find(x => x.key === key);
  const detail = (S.config.detailMap || []).find(d => d.main === f.main && d.sub === f.sub);
  if (r.src === 'MANUAL') {
    const m = S.manual.find(x => x.id === r.manualId || x._id === r.manualId);
    const body = { ...m, date: f.date, amount: +f.amount, desc: f.desc, account: f.account, txType: f.txType, life: +f.life, main: f.main || null, sub: f.sub || null, essential: f.essential || detail?.essential || null, fixed: f.fixed || detail?.fixed || null };
    delete body._id;
    if (await write('manual/' + r.manualId, body)) { closeSheet(); toast('已儲存'); }
    return;
  }
  const body = { kind: 'app', key, main: f.main || null, sub: f.sub || null, essential: f.essential || null, fixed: f.fixed || null, life: +f.life, updatedAt: new Date().toISOString() };
  if (f.txType) body.txType = f.txType;
  if (await write('ovr/' + hashId('a', key), body)) { closeSheet(); toast('分類已更新'); }
}
function sheetManual(prefill = {}) {
  const today = new Date(); const d = prefill.date || `${S.month}-${String(Math.min(today.getDate(), 28)).padStart(2, '0')}`;
  openSheet(`<h3>記一筆</h3><form class="form" id="manform">
    <div class="fields2"><div class="field"><label for="m-date">日期</label><input id="m-date" name="date" type="date" value="${d}"></div><div class="field"><label for="m-amt">金額</label><input id="m-amt" name="amount" inputmode="decimal" value="${prefill.amount ?? ''}" placeholder="0"></div></div>
    <div class="field"><label for="m-desc">描述</label><input id="m-desc" name="desc" value="${esc(prefill.desc || '')}" placeholder="例如：午餐 牛肉麵"></div>
    <div class="fields2"><div class="field"><label for="m-type">交易類型</label><select id="m-type" name="txType">${opt(TX, 'Expense')}</select></div><div class="field"><label for="m-acct">帳戶</label><input id="m-acct" name="account" list="acctlist" value="${esc(prefill.account || '')}"><datalist id="acctlist"><option value="玉山 unicard"><option value="現金"><option value="兆豐-薪轉"></datalist></div></div>
    <div class="fields2"><div class="field"><label for="m-main">主分類</label><select id="m-main" name="main">${opt(E.MAIN_CATS, prefill.main || '餐飲')}</select></div><div class="field"><label for="m-sub">次分類</label><input id="m-sub" name="sub" list="msub"><datalist id="msub">${subOptions(prefill.main || '餐飲').map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <p class="sub" style="margin:0">手動紀錄會跟 APP 匯入的資料一起算。之後 APP 也有記同一筆的話，記得刪掉這筆。</p>
  </form><div class="acts"><button class="btn" data-act="closesheet">取消</button><button class="btn primary" data-act="savemanual">新增</button></div>`);
  $('#m-main').addEventListener('change', e => { $('#msub').innerHTML = subOptions(e.target.value).map(s => `<option value="${esc(s)}">`).join(''); });
}
async function saveManual() {
  const f = Object.fromEntries(new FormData($('#manform')));
  if (!f.date || !f.amount || isNaN(+f.amount)) { toast('請填日期和金額'); return; }
  const detail = (S.config.detailMap || []).find(d => d.main === f.main && d.sub === f.sub);
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const body = { id, date: f.date, amount: +f.amount, desc: f.desc, account: f.account, txType: f.txType, life: f.txType === 'Expense' ? 1 : 0, main: f.main, sub: f.sub || null, essential: detail?.essential || null, fixed: detail?.fixed || null, createdAt: new Date().toISOString() };
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
function sheetPair(side, key) {
  const r = S.res;
  const self = side === 'app' ? r.app.find(a => a.key === key) : r.card.find(c => c.key === key);
  if (!self) return;
  const used = new Set(r.recon.filter(x => x.status === '成功配對').flatMap(x => [x.app && x.app.key, x.card && x.card.key]));
  const pool = side === 'app' ? r.card : r.app.filter(a => a.type === 'Expense' && E.util.normApp(a.account) === E.util.normApp(S.config.cardAccount || '玉山 unicard'));
  const cands = pool.filter(o => !used.has(o.key) && Math.abs(E.util.dayDiff(o.date, self.date)) <= 5)
    .map(o => ({ o, score: Math.abs(o.amount - self.amount) / Math.max(1, self.amount) + Math.abs(E.util.dayDiff(o.date, self.date)) * 0.02 }))
    .sort((a, b) => a.score - b.score).slice(0, 12);
  openSheet(`<h3>${side === 'app' ? '找對應的刷卡紀錄' : '找對應的 APP 紀錄'}</h3>
    <div class="facts"><b>${esc(side === 'app' ? (self.desc || self.bill) : self.merchant)}</b><span class="num">${self.date}・${fmt(self.amount)}</span></div>
    <div class="list">${cands.map(({ o }) => `<button type="button" class="row" data-act="pairset" data-a="${esc(side === 'app' ? key : o.key)}" data-c="${esc(side === 'app' ? o.key : key)}"><span><span class="t">${esc(side === 'app' ? o.merchant : (o.desc || o.bill))}</span><span class="m">${o.date}${o.amount !== self.amount ? `<span class="pill warn">差 ${sgn(o.amount - self.amount)}</span>` : ''}</span></span><span class="a">${fmt(o.amount)}</span></button>`).join('') || '<div class="sub">前後 5 天內沒有候選。</div>'}</div>
    <p class="sub" style="margin:0">金額不同代表 APP 記的金額跟帳單不一樣，配對後建議回 APP 修正。</p>
    <div class="acts">${side === 'app' ? `<button class="btn" data-act="ignore" data-key="${esc(key)}">這筆不是刷卡，忽略</button>` : ''}<button class="btn" data-act="closesheet">關閉</button></div>`);
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

// ---------------------------------------------------------------- events
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; try { localStorage.setItem('fin.tab', S.tab); } catch (_) {} closeSheet(); render(); window.scrollTo({ top: 0 }); return; }
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
  else if (a === 'addmanual') sheetManual();
  else if (a === 'savemanual') saveManual();
  else if (a === 'delmanual') { if (t.dataset.confirm) { if (await remove('manual/' + d.id)) { closeSheet(); toast('已刪除'); } } else { t.dataset.confirm = '1'; t.textContent = '再按一次確認刪除'; } }
  else if (a === 'pairok' || a === 'pairset') { if (await write('ovr/' + hashId('p', d.a + '>' + d.c), { kind: 'cardmatch', appKey: d.a, cardKey: d.c, createdAt: new Date().toISOString() })) { closeSheet(); toast('已配對'); } }
  else if (a === 'pairpick') sheetPair(d.side, d.key);
  else if (a === 'ignore') { if (await write('ovr/' + hashId('i', d.key), { kind: 'cardignore', key: d.key, createdAt: new Date().toISOString() })) { closeSheet(); toast('已忽略'); } }
  else if (a === 'cardadd') { const c = S.res.card.find(x => x.key === d.key); if (c) sheetManual({ date: c.date, amount: c.amount, desc: c.merchant, account: S.config.cardAccount || '玉山 unicard' }); }
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
  else if (a === 'impcancel') { S.import = null; render(); }
  else if (a === 'impgo') runImport();
  else if (a === 'delraw') { if (t.dataset.confirm) { if (await remove('raw/' + d.id)) toast('已刪除'); } else { t.dataset.confirm = '1'; t.textContent = '確認刪除？'; } }
  else if (a === 'delovr') { if (await remove('ovr/' + d.id)) toast('已移除規則'); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'month-select') { S.month = e.target.value; render(); }
  if (e.target.id === 'restore-file' && e.target.files[0]) restoreBackup(e.target.files[0]);
  if (e.target.id === 'pick-dir' || e.target.id === 'pick-files') { if (e.target.files.length) handleFiles(e.target.files); }
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
