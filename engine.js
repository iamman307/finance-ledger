/* Finance V3 engine — parsers + ledger rules (ported from Finance V2 Power Query / VBA).
   Works in the browser (window.FinEngine) and in Node (module.exports). */
(function (root) {
  'use strict';
  const E = {};

  // ---------------------------------------------------------------- utils
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '');
  const txt = v => (v == null ? '' : String(v));
  function serialToISO(n) {
    const d = new Date(Math.round((Math.floor(n) - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  function toISODate(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'number' && isFinite(v)) return v > 20000 && v < 80000 ? serialToISO(v) : null;
    const s = String(v).replace(/\*/g, '').trim();
    const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (!m) return null;
    const mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[1]}-${pad(mo)}-${pad(d)}`;
  }
  function toHHMMSS(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'number') {
      let secs = Math.round((v - Math.floor(v)) * 86400);
      if (secs >= 86400) secs = 86399;
      return pad(Math.floor(secs / 3600)) + pad(Math.floor(secs / 60) % 60) + pad(secs % 60);
    }
    const m = String(v).trim().match(/(\d{1,2}):(\d{2}):(\d{2})/);
    return m ? pad(+m[1]) + m[2] + m[3] : null;
  }
  function toNum(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v).replace(/,/g, '').trim();
    if (s === '') return 0;
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function toNumOrNull(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = Number(String(v).replace(/,/g, '').trim());
    return isFinite(n) ? n : null;
  }
  const numText = n => (n == null ? '' : Number.isInteger(n) ? String(n) : String(+n.toFixed(10)));
  const ymd = iso => (iso ? iso.replace(/-/g, '') : '');
  const ym = iso => (iso ? iso.slice(0, 7) : null);
  function dayDiff(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }
  function addMonths(ymStr, k) {
    let [y, m] = ymStr.split('-').map(Number);
    m += k; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  }
  function monthsBetween(a, b) { // b - a in months, ymStr
    const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
  }
  function hash(s) { // FNV-1a 32-bit -> base36
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  // APP key normalisation (DB_APP.NormalizeText)
  const normApp = x => (x == null ? '' : String(x).trim().replace(/ /g, '').replace(/　/g, '').toLowerCase());
  // BANK key normalisation (DB_BANK.NormalizeText)
  function normBank(x) {
    if (x == null) return null;
    let s = String(x).replace(/[\u0000-\u001f\u007f]/g, '');
    s = s.replace(/[ 　 ​﻿]/g, '').trim().toLowerCase();
    return s === '' ? null : s;
  }
  function normCounterparty(x) {
    if (isBlank(x)) return null;
    return String(x).trim().replace(/-/g, '/');
  }
  function cpMatchKey(x) {
    const s = normCounterparty(x);
    if (!s || !s.includes('/')) return null;
    const i = s.indexOf('/');
    const bank = s.slice(0, i);
    let acct = s.slice(i + 1).replace(/^0+/, '');
    if (acct === '') acct = '0';
    return bank && acct ? bank + '/' + acct : null;
  }
  E.util = { toISODate, toHHMMSS, toNum, numText, hash, addMonths, monthsBetween, dayDiff, normApp, normBank, cpMatchKey };

  // ------------------------------------------------------------ file kinds
  // Classify a file by its folder path / name.
  E.detectKind = function (path) {
    const p = path.replace(/\\/g, '/');
    const name = p.split('/').pop();
    if (/^~\$|^～＄/.test(name)) return null;
    if (!p.includes('/')) { // bare file name (picked individually)
      if (/^stock-ledger-.*\.json$/i.test(name)) return 'invest';
      if (!/^\d{4}-\d{2}_.+\.xlsx?$/i.test(name)) return null;
      if (/unicard|信用卡/i.test(name)) return 'card-esun';
      if (/^\d{4}-\d{2}_兆豐/.test(name)) return 'bank-mega';
      if (/^\d{4}-\d{2}_玉山/.test(name)) return 'bank-esun';
      return 'app';
    }
    if (/APP_RAW\//i.test(p) && /\.xlsx?$/i.test(name)) return 'app';
    if (/BANK_RAW\/兆豐\//.test(p) && /\.xlsx?$/i.test(name)) return 'bank-mega';
    if (/BANK_RAW\/玉山\//.test(p) && /\.xlsx?$/i.test(name)) return 'bank-esun';
    if (/CARD_RAW\/玉山\//.test(p) && /\.xlsx?$/i.test(name)) return 'card-esun';
    if (/INVEST_RAW\/APP\//i.test(p) && /^stock-ledger-.*\.json$/i.test(name)) return 'invest';
    return null;
  };
  E.fileDocId = (kind, name) => `${kind}.${name.slice(0, 7).replace(/[^0-9-]/g, '')}.${hash(kind + '|' + name)}`;

  // ------------------------------------------------------------ parsers
  // rows: 2D array (sheet_to_json header:1, raw:true)
  E.parseApp = function (fileName, rows) {
    const base = fileName.replace(/\.xlsx?$/i, '');
    const problems = [];
    if (!/^\d{4}-\d{2}_.+/.test(base)) throw new Error('APP 檔名必須是 YYYY-MM_帳本.xlsx：' + fileName);
    const month = base.slice(0, 7), book = base.slice(8).trim();
    const hdr = (rows[0] || []).map(h => txt(h).trim());
    const col = n => hdr.indexOf(n);
    const need = ['日期', '帳單', '金額', '類型', '成員', '帳戶', '帳本', '備註'];
    const miss = need.filter(n => col(n) < 0);
    if (miss.length) throw new Error(`APP 欄位不完整（缺 ${miss.join('、')}）：${fileName}`);
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.every(isBlank)) continue;
      const g = n => row[col(n)];
      const note = isBlank(g('備註')) ? null : txt(g('備註'));
      out.push({
        date: toISODate(g('日期')), bill: isBlank(g('帳單')) ? null : txt(g('帳單')),
        amount: toNumOrNull(g('金額')), type: isBlank(g('類型')) ? null : txt(g('類型')),
        member: isBlank(g('成員')) ? null : txt(g('成員')), account: isBlank(g('帳戶')) ? null : txt(g('帳戶')),
        ledger: isBlank(g('帳本')) ? null : txt(g('帳本')), note,
      });
    }
    return { kind: 'app', file: fileName, month, book, rows: out, problems };
  };

  function findHeader(sheets, firstCell, maxRow = 40) {
    for (const [name, rows] of sheets) {
      for (let r = 0; r < Math.min(maxRow, rows.length); r++) {
        if (txt((rows[r] || [])[0]).trim() === firstCell) return { name, rows, r };
      }
    }
    return null;
  }
  function headerValue(rows, upto, label) {
    for (let r = 0; r < upto; r++) {
      const row = rows[r] || [];
      const c0 = txt(row[0]).trim();
      if (c0 === label) return txt(row[1]).trim();
      if (c0.startsWith(label)) return c0.slice(label.length).replace(/^[\s:：]+/, '').trim();
    }
    return '';
  }

  // sheets: array of [sheetName, rows]
  E.parseBankMega = function (fileName, sheets) {
    if (!/^\d{4}-\d{2}/.test(fileName)) throw new Error('BANK 檔名必須以 YYYY-MM 開頭：' + fileName);
    const h = findHeader(sheets, '交易時間');
    if (!h) throw new Error('兆豐找不到「交易時間」表頭：' + fileName);
    const hdr = h.rows[h.r].map(x => txt(x).trim());
    const c = n => hdr.indexOf(n);
    const ci = { t: c('交易時間'), post: c('銀行帳務日'), desc: c('交易項目'), out: c('支出'), inn: c('收入'), bal: c('帳戶餘額'), note: c('存摺備註'), helper: c('記帳小幫手') };
    if (ci.out < 0 || ci.inn < 0) throw new Error('兆豐表頭缺少「支出/收入」：' + fileName);
    const acctNo = (headerValue(h.rows, h.r, '帳號').match(/\d{8,}/) || [''])[0];
    const out = [];
    for (let r = h.r + 1; r < h.rows.length; r++) {
      const row = h.rows[r] || [];
      const s = txt(row[ci.t]).replace(/\*/g, '').trim();
      const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
      if (!m) break;
      const note = txt(row[ci.note]);
      const x = note.trim();
      const cp = (x.length >= 5 && /^\d{3}$/.test(x.slice(0, 3)) && (x[3] === '-' || x[3] === '/')) ? x.slice(0, 3) + '/' + x.slice(4) : '';
      out.push({
        date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] + m[5] + m[6], post: toISODate(row[ci.post]),
        desc: txt(row[ci.desc]), out: toNum(row[ci.out]), in: toNum(row[ci.inn]), fee: 0,
        bal: toNumOrNull(row[ci.bal]), note, cp, msg: ci.helper >= 0 ? txt(row[ci.helper]) : '',
      });
    }
    return { kind: 'bank', bank: '兆豐', account: '兆豐', acctNo, file: fileName, month: fileName.slice(0, 7), rows: out, problems: [] };
  };

  E.parseBankEsun = function (fileName, sheets) {
    if (!/^\d{4}-\d{2}/.test(fileName)) throw new Error('BANK 檔名必須以 YYYY-MM 開頭：' + fileName);
    const h = findHeader(sheets, '交易日期');
    if (!h) throw new Error('玉山找不到「交易日期」表頭：' + fileName);
    const hdr = h.rows[h.r].map(x => txt(x).trim());
    const find = (...names) => { for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) return i; } return -1; };
    const ci = {
      d: find('交易日期'), t: find('交易時間'), desc: find('摘要'), out: find('提', '提款', '支出'), inn: find('存', '存款', '存入'),
      fee: find('手續費'), bal: find('帳戶餘額', '餘額'), note: find('存摺備註', '備註'),
      cp: find('對方銀行代碼/帳號', '銀行代號/帳號', '對方銀行/帳號', '對方帳號'), msg: find('轉帳留言'),
    };
    const missing = Object.entries({ 交易時間: ci.t, 摘要: ci.desc, 提: ci.out, 存: ci.inn }).filter(([, v]) => v < 0).map(([k]) => k);
    if (missing.length) throw new Error(`玉山表頭缺少：${missing.join('、')}（${fileName}）`);
    const acctNo = (headerValue(h.rows, h.r, '帳號').match(/\d{8,}/) || [''])[0];
    const g = (row, i) => (i >= 0 ? row[i] : null);
    const out = [];
    for (let r = h.r + 1; r < h.rows.length; r++) {
      const row = h.rows[r] || [];
      const date = toISODate(row[ci.d]);
      if (!date) break;
      out.push({
        date, time: toHHMMSS(row[ci.t]), post: null, desc: txt(g(row, ci.desc)),
        out: toNum(g(row, ci.out)), in: toNum(g(row, ci.inn)), fee: toNum(g(row, ci.fee)),
        bal: toNumOrNull(g(row, ci.bal)), note: txt(g(row, ci.note)), cp: txt(g(row, ci.cp)), msg: txt(g(row, ci.msg)),
      });
    }
    return { kind: 'bank', bank: '玉山', account: '玉山', acctNo, file: fileName, month: fileName.slice(0, 7), rows: out, problems: [] };
  };

  // E.SUN credit-card statement exported as xlsx (one text column, 2026-09 format onwards)
  E.parseCardEsun = function (fileName, sheets) {
    if (!/^\d{4}-\d{2}/.test(fileName)) throw new Error('信用卡檔名必須以 YYYY-MM 開頭：' + fileName);
    const stmt = fileName.slice(0, 7);
    const [sy, sm] = stmt.split('-').map(Number);
    const lines = [];
    for (const [, rows] of sheets) for (const row of rows) {
      const s = (row || []).filter(v => !isBlank(v)).map(v => txt(v).trim()).join(' ').trim();
      if (s) lines.push(s);
    }
    let section = 'head', last4 = '', total = null, due = null, minDue = null;
    const out = [], problems = [];
    const lineRe = /^(\d{2})\/(\d{2})\s+(\d{2})\/(\d{2})\s+(.+)$/;
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i];
      if (/^繳款幣別/.test(s) && lines[i + 1]) {
        const nums = (lines[i + 1].match(/-?[\d,]+(?:\.\d+)?/g) || []).map(toNum);
        if (nums.length >= 4) { due = nums[2]; minDue = nums[3]; }
      }
      if (/本期費用明細/.test(s)) { section = 'fee'; continue; }
      if (/本期消費明細/.test(s)) { section = 'purchase'; continue; }
      const mt = s.match(/本期應繳總金額[:：]\s*TWD\s*(-?[\d,]+)/); if (mt) { total = toNum(mt[1]); continue; }
      const mc = s.match(/卡號[:：]\s*[\dX-]*?(\d{4})\(/); if (mc) { last4 = mc[1]; continue; }
      const m = s.match(lineRe);
      if (!m) continue;
      let rest = m[5];
      const pt = rest.match(/使用\s*e\s*point\s*([\d,]+)\s*點折現金\s*([\d,]+)\s*元/i);
      if (pt) { if (out.length) out[out.length - 1].points = toNum(pt[2]); continue; }
      if (/感謝您|自動轉帳繳款|繳款/.test(rest) && section === 'head') continue; // payment line
      const flag = (rest.match(/\s([SGA])$/) || [])[1] || '';
      if (flag) rest = rest.replace(/\s[SGA]$/, '');
      const amts = [...rest.matchAll(/\b([A-Z]{3})\s+(-?[\d,]+(?:\.\d+)?)/g)];
      const twd = amts.filter(a => a[1] === 'TWD');
      if (!twd.length) continue; // e.g. 使用e point折現金 (informational)
      const billing = toNum(twd[twd.length - 1][2]);
      const first = amts[0];
      let merchant = rest.slice(0, first.index).trim();
      merchant = merchant.replace(/\s\d{2}\/\d{2}$/, '').trim(); // foreign conversion date
      let origCur = first[1], origAmt = toNum(first[2]);
      const inst = merchant.match(/分(\d+)期之第(\d+)期/);
      const mon = +m[1], day = +m[2];
      let y = sy;
      if (mon - sm > 6) y = sy - 1; else if (sm - mon > 6) y = sy + 1;
      out.push({
        date: `${y}-${pad(mon)}-${pad(day)}`, post: `${y}-${m[3]}-${m[4]}`, merchant, amount: billing,
        origCur, origAmt, last4, section, flag, installment: inst ? `${inst[2]}/${inst[1]}` : null,
        kind: section === 'fee' && /e\s*point|折抵/i.test(merchant) ? 'points-credit' : /國外交易服務費|手續費|年費|循環利息|違約金/.test(merchant) ? 'fee' : 'purchase',
      });
    }
    if (!out.length) problems.push('沒有解析到任何交易，請確認是玉山信用卡帳單 xlsx');
    return { kind: 'card', bank: '玉山', file: fileName, month: stmt, statementTotal: total ?? due, minDue, rows: out, problems };
  };

  // Stock Ledger JSON -> compact snapshot
  E.parseInvest = function (fileName, json) {
    const quotes = json.quotes || {};
    const tx = [...(json.transactions || [])].sort((a, b) => txt(a.date).localeCompare(txt(b.date)));
    const pos = new Map();
    for (const t of tx) {
      const k = t.account + '|' + t.ticker;
      const p = pos.get(k) || { account: t.account, ticker: t.ticker, asset: t.asset, currency: t.currency || 'TWD', qty: 0, costBase: 0, costTwd: 0 };
      const fx = +t.fx || 1, q = +t.qty || 0, px = +t.price || 0, fee = (+t.fee || 0) + (+t.tax || 0);
      if (t.side === 'BUY' || t.side === 'INIT') { p.qty += q; p.costBase += q * px + (t.side === 'BUY' ? fee : 0); p.costTwd += (q * px + (t.side === 'BUY' ? fee : 0)) * fx; }
      else if (t.side === 'SELL' && p.qty > 0) { const f = Math.min(1, q / p.qty); p.costBase *= 1 - f; p.costTwd *= 1 - f; p.qty -= q; }
      pos.set(k, p);
    }
    const holdings = [];
    for (const p of pos.values()) {
      if (Math.abs(p.qty) < 1e-9) continue;
      const qt = quotes[p.ticker] || {};
      const price = +qt.price || 0, fx = p.currency === 'TWD' ? 1 : (+qt.fx || +(json.meta || {}).currentUsdTwd || 1);
      const mvTwd = p.qty * price * fx;
      holdings.push({ account: p.account, ticker: p.ticker, asset: p.asset, currency: p.currency, qty: +p.qty.toFixed(6), price, fx, costTwd: Math.round(p.costTwd), mvTwd: Math.round(mvTwd), quoteAt: qt.updated || null });
    }
    const external = (json.externalHoldings || []).map(h => ({ ticker: h.ticker, venue: h.venue, asOf: h.asOf, mvTwd: Math.round(+h.marketValueTwd || 0), unrealizedTwd: h.unrealizedTwd == null ? null : Math.round(h.unrealizedTwd) }));
    const sc = (json.meta || {}).securitiesCash || {};
    return {
      kind: 'invest', file: fileName, asOf: (json.meta || {}).lastQuoteSnapshot || null, appVersion: (json.meta || {}).appVersion || null,
      usdTwd: (json.meta || {}).currentUsdTwd || null, holdings, external,
      brokerCashTwd: sc.enabled ? Math.round(+sc.accountBalanceTwd || 0) : null, cashPlan: json.cash || null,
      closedTrades: (json.manualTrades || []).length,
    };
  };

  // ------------------------------------------------------------ config from V2 tables
  E.configFromV2 = function (t) {
    const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== ''));
    const stripFile = key => { const p = String(key).split('|'); return p[0] === 'BANK' ? p.slice(2).join('|') : key; };
    return {
      version: 3, bankStart: '2026-08-01',
      ownAccounts: t.tbl_MAP_自有帳戶.map(r => ({ cp: r.Counterparty, name: r.Own_Account_Name })),
      cpRules: t['tbl_MAP_BANK_對手方規則'].map(r => clean({ cp: r.Counterparty_Key, name: r['對手方名稱'], bankType: r.Rule_Bank_Type, txType: r.Rule_Transaction_Type, owner: r.Income_Owner, memo: r['備註'] })),
      textRules: t['tbl_MAP_BANK_交易規則'].map(r => clean({ desc: r.Bank_Description, note: r['Bank note'], flow: r.Flow_Direction, bankType: r.Rule_Bank_Type, txType: r.Rule_Transaction_Type, memo: r['備註'] })),
      bankOverrides: t['tbl_MAP_BANK_手動覆寫'].map(r => clean({ key: stripFile(r.Bank_Transaction_Key), bankType: r.Override_Bank_Type, txType: r.Override_Transaction_Type, owner: r.Override_Income_Owner, memo: r['備註'], ledgerInclude: r.Override_Ledger_Include ? 1 : undefined })),
      appMap: t['tbl_MAP_分類'].map(r => clean({ book: r['來源帳本'], main: r['正式帳本'], position: r['帳本定位'], txType: r.Transaction_Type, life: r['是否算生活支出'] })),
      detailMap: t['tbl_MAP_明細分類'].map(r => clean({ main: r['主分類'], sub: r['次分類'], essential: r['必要性預設'], fixed: r['固定/變動預設'], old: r['舊APP分類'], memo: r['備註'] })),
      specialRules: t['tbl_MAP_APP_歷史特殊規則'].map(r => clean({ book: r['來源帳本'], ledger: r['帳本'], bill: r['帳單'], type: r['類型'], keyword: r['備註關鍵字'], main: r['正式帳本'], txType: r['Transaction_Type覆寫'], life: r['是否算生活支出'], memo: r['備註'], sub: r['次分類覆寫'], essential: r['必要性覆寫'], fixed: r['固定/變動覆寫'] })),
      splits: t['tbl_MAP_APP_歷史拆分'].map(r => clean({ file: r['來源檔案'], date: r['日期'], bill: r['原始帳單'], amount: r['原始金額'], keyword: r['備註關鍵字'], seq: r['拆分序號'], splitAmount: r['拆分金額'], txType: r.Transaction_Type, main: r['正式帳本'], sub: r['次分類'], life: r['是否算生活支出'], essential: r['必要性'], fixed: r['固定/變動'], memo: r['備註'] })),
      debts: t['tbl_負債分期'].map(r => r['類型'] === '信貸' ? clean({ name: '信貸', type: '信貸', principal: r['原始本金'], rate: r['年利率'], n: r['總期數'], start: '2026-09', payment: 19113 }) : clean({ name: r['項目名稱'], type: r['類型'], principal: r['原始本金'], rate: r['年利率'], n: r['總期數'], start: r['開始月份'] ? String(r['開始月份']).slice(0, 7) : null, payment: r['類型'] === '信貸' ? undefined : r['每月應付'], balanceOverride: r['目前本金覆寫'] })),
      bankTypes: Object.fromEntries(t.tbl_DICT_Bank_Type.map(r => [r.Bank_Type, { zh: r['中文意義'], txType: r['建議 Transaction_Type'], use: r['用途'] }])),
      cardAccount: '玉山 unicard',
    };
  };

  // ------------------------------------------------------------ debts
  E.debtStatus = function (d, reportYM) {
    const r = (+d.rate || 0) / 12, n = +d.n || 0, P = +d.principal || 0;
    let pay = d.payment != null && d.payment !== '' ? +d.payment : null;
    if (pay == null && n > 0) pay = r > 0 ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
    const start = d.start;
    const end = start && n ? addMonths(start, n - 1) : null;
    let paid = 0;
    if (start && n) paid = Math.max(0, Math.min(n, monthsBetween(start, reportYM) + 1));
    let bal;
    if (d.balanceOverride != null && d.balanceOverride !== '') bal = +d.balanceOverride;
    else if (r > 0) bal = P * Math.pow(1 + r, paid) - pay * (Math.pow(1 + r, paid) - 1) / r;
    else bal = n ? P * (n - paid) / n : P;
    const active = start && end && start <= reportYM && reportYM <= end;
    return { payment: pay, end, paid, remainingN: n - paid, balance: Math.max(0, Math.round(bal)), active, status: paid >= n ? '已結清' : (start > reportYM ? '未開始' : '進行中') };
  };
  E.debtCashForMonth = (debts, m) => debts.reduce((s, d) => { const st = E.debtStatus(d, m); return s + (st.active ? st.payment : 0); }, 0);

  // ------------------------------------------------------------ main compute
  // state: { files:[parsed docs], config, ovr:[{kind,...}], manual:[...] }
  E.compute = function (state) {
    const cfg = state.config;
    const ovr = state.ovr || [];
    const issues = [];
    const files = state.files || [];

    // ======================= APP =======================
    const appFiles = files.filter(f => f.kind === 'app').sort((a, b) => a.file.localeCompare(b.file));
    const splitMap = new Map();
    for (const s of cfg.splits || []) {
      const k = [normApp(s.file), ymd(s.date), normApp(s.bill), numText(+s.amount)].join('|');
      if (!splitMap.has(k)) splitMap.set(k, []);
      splitMap.get(k).push(s);
    }
    const appMap = new Map((cfg.appMap || []).map(r => [r.book, r]));
    const special = (cfg.specialRules || []).map(r => ({ ...r, _key: [normApp(r.book), normApp(r.ledger), normApp(r.bill), normApp(r.type)].join('|'), _kw: normApp(r.keyword) }));
    const detail = new Map();
    for (const d of cfg.detailMap || []) if (d.old) { const k = d.main + '|' + d.old; if (!detail.has(k)) detail.set(k, d); }
    const appOvr = new Map(ovr.filter(o => o.kind === 'app').map(o => [o.key, o]));
    const rawTypeMap = { 支出: 'Expense', 收入: 'Income', 轉帳: 'Transfer', 傳帳: 'Transfer' };

    const app = [];
    const seenAppKey = new Map();
    for (const f of appFiles) {
      for (const r of f.rows) {
        if (!r.date && r.amount == null) continue; // footer line such as "2026-01-01 to 2026-01-31"
        if (!r.date || r.amount == null) { issues.push({ type: 'APP資料異常', month: f.month, file: f.file, text: `缺日期或金額：${r.bill || ''} ${r.note || ''}`, sev: 2 }); continue; }
        if (ym(r.date) !== f.month) { issues.push({ type: 'APP資料異常', month: f.month, file: f.file, text: `日期 ${r.date} 不在檔案月份 ${f.month}（已排除）：${r.bill || ''} ${r.amount}`, sev: 2 }); continue; }
        const baseKey = ['A', f.book, r.date, numText(r.amount), r.account || '', r.type || '', r.bill || '', r.note || ''].join('|');
        const occ = (seenAppKey.get(baseKey) || 0) + 1; seenAppKey.set(baseKey, occ);
        const key = occ > 1 ? baseKey + '#' + occ : baseKey;
        const noteN = normApp(r.note);
        // split
        const sk = [normApp(f.file), ymd(r.date), normApp(r.bill), numText(r.amount)].join('|');
        const splits = (splitMap.get(sk) || []).filter(s => !normApp(s.keyword) || noteN.includes(normApp(s.keyword))).sort((a, b) => a.seq - b.seq);
        if (splits.length) {
          const sum = splits.reduce((s, x) => s + (+x.splitAmount), 0);
          if (Math.abs(sum - r.amount) > 1e-6) issues.push({ type: '設定錯誤', month: f.month, file: f.file, text: `拆分金額不守恆：${r.date} ${r.bill} ${r.amount} ≠ ${sum}`, sev: 3 });
        }
        const gen = appMap.get(f.book) || null;
        const spKey = [normApp(f.book), normApp(r.ledger), normApp(r.bill), normApp(r.type)].join('|');
        const sp = special.filter(s => s._key === spKey && (!s._kw || noteN.includes(s._kw))).sort((a, b) => b._kw.length - a._kw.length)[0] || null;
        const parts = splits.length ? splits.map(s => ({ s })) : [{ s: null }];
        for (const { s } of parts) {
          const has = v => v != null && String(v).trim() !== '';
          let main = s ? s.main : (sp && has(sp.main) ? sp.main : gen ? gen.main : null);
          const rawMapped = rawTypeMap[(r.type || '').trim()] || '';
          let type;
          if (s && has(s.txType)) type = s.txType;
          else if (sp && has(sp.txType)) type = sp.txType;
          else if (gen && ['Investment', 'Debt', 'Adjustment'].includes(gen.txType)) type = gen.txType;
          else if (rawMapped) type = rawMapped;
          else if (gen && has(gen.txType)) type = gen.txType;
          else type = 'Unknown';
          let lifeMap = s ? s.life : (sp && sp.life != null ? sp.life : gen ? gen.life : null);
          const det = detail.get(main + '|' + r.bill) || null;
          let sub = s ? (s.sub ?? null) : (sp && has(sp.sub) ? sp.sub : det ? det.sub : null);
          let essential = s ? (s.essential ?? null) : (sp && has(sp.essential) ? sp.essential : det ? det.essential : null);
          let fixed = s ? (s.fixed ?? null) : (sp && has(sp.fixed) ? sp.fixed : det ? det.fixed : null);
          let amount = s ? +s.splitAmount : (type === 'Expense' && r.type === '收入' ? -Math.abs(r.amount) : r.amount);
          let note = s ? (s.memo ?? null) : (sp && has(sp.memo) ? sp.memo : null);
          const k = s ? key + '|S' + s.seq : key;
          const o = appOvr.get(k);
          let edited = false;
          if (o) {
            edited = true;
            if (has(o.main)) main = o.main;
            if (has(o.txType)) type = o.txType;
            if (o.life != null) lifeMap = o.life;
            if (o.sub !== undefined) sub = o.sub;
            if (o.essential !== undefined) essential = o.essential;
            if (o.fixed !== undefined) fixed = o.fixed;
            if (has(o.memo)) note = o.memo;
          }
          const share = o && o.myShare != null && o.myShare !== '' ? +o.myShare : null;
          const account = o && has(o.account) ? o.account : r.account;
          const life = type === 'Expense' && +lifeMap === 1 ? 1 : 0;
          app.push({
            key: k, src: 'APP', date: r.date, month: f.month, book: f.book, file: f.file, bill: r.bill, desc: r.note, amount: share != null ? share : amount, gross: amount,
            account, member: r.member, rawType: r.type, ledger: r.ledger, type, life, main, sub, essential, fixed, note,
            split: s ? s.seq : null, include: 1, dup: 0, edited, unmappedBook: !gen && !sp && !s,
            share, splitWith: o ? o.splitWith || null : null,
          });
        }
      }
    }
    // manual transactions (entered on phone) behave like APP rows
    for (const m of state.manual || []) {
      if (!m.date || m.amount == null) continue;
      const type = m.txType || 'Expense';
      const share = m.myShare != null && m.myShare !== '' ? +m.myShare : null;
      app.push({
        key: 'M|' + m.id, src: 'MANUAL', date: m.date, month: ym(m.date), book: '手動', file: '手動新增', bill: m.sub || m.main || '', desc: m.desc || '',
        amount: share != null ? share : +m.amount, gross: +m.amount, share, splitWith: m.splitWith || null, cardKey: m.cardKey || null, account: m.account || '', member: '自己', rawType: '', ledger: '', type, life: type === 'Expense' && m.life !== 0 ? 1 : 0,
        main: m.main || null, sub: m.sub || null, essential: m.essential || null, fixed: m.fixed || null, note: m.memo || null, split: null, include: 1, dup: 0, edited: false, manualId: m.id,
      });
    }
    const settles = ovr.filter(o => o.kind === 'settle');
    const settledTx = new Map(); for (const st of settles) settledTx.set(st.txKey, st);
    for (const a of app) if (settledTx.has(a.key)) { a.type = 'Transfer'; a.life = 0; a.settlement = true; a.main = a.main || '代墊款回收'; }
    app.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    app.forEach((r, i) => { r.id = 'APP-' + ymd(r.date) + '-' + pad(i + 1, 4); });

    // ======================= BANK =======================
    const bankFiles = files.filter(f => f.kind === 'bank').sort((a, b) => a.file.localeCompare(b.file));
    const own = new Map(); for (const o of cfg.ownAccounts || []) { const k = cpMatchKey(o.cp); if (k) own.set(k, o.name); }
    const cpr = new Map(); for (const c of [...(cfg.cpRules || []), ...ovr.filter(o => o.kind === 'cprule')]) { const k = cpMatchKey(c.cp); if (k) cpr.set(k, c); }
    const textSpecific = new Map(), textGeneric = new Map();
    for (const t of cfg.textRules || []) {
      const d = normBank(t.desc), n = normBank(t.note);
      if (!d) continue;
      if (n) textSpecific.set(d + '|' + n + '|' + t.flow, t); else textGeneric.set(d + '|' + t.flow, t);
    }
    const bankOvr = new Map((cfg.bankOverrides || []).map(o => [o.key, o]));
    for (const o of ovr.filter(o => o.kind === 'bank')) bankOvr.set(o.key, { ...bankOvr.get(o.key), ...o });

    const bank = [];
    for (const f of bankFiles) {
      const occ = new Map();
      for (const r of f.rows) {
        if (!r.date || !r.time) continue;
        const amount = (+r.in || 0) - (+r.out || 0);
        const flow = amount > 0 ? 'Inflow' : amount < 0 ? 'Outflow' : 'Zero';
        const cp = normCounterparty(r.cp);
        let cpKey = cpMatchKey(cp);
        const noteT = (r.note || '').trim();
        if (!cpKey && f.account === '兆豐' && /^\d{8,16}$/.test(noteT)) cpKey = cpMatchKey('017/' + noteT);
        const descKey = normBank(r.desc), noteKey = normBank(r.note);
        const dupBase = [f.account, ymd(r.date), r.time, numText(amount), r.desc || ''].concat(cp ? [cp] : []).join('|');
        const n = (occ.get(dupBase) || 0) + 1; occ.set(dupBase, n);
        const dupKey = n > 1 ? dupBase + '#' + n : dupBase;
        bank.push({
          src: 'BANK', file: f.file, account: f.account, acctNo: f.acctNo, date: r.date, time: r.time, post: r.post, desc: r.desc, note: r.note, msg: r.msg,
          amount, fee: r.fee || 0, bal: r.bal, flow, cp, cpKey, descKey, noteKey, key: dupKey,
          srcMonthMatch: f.file.slice(0, 7) === ym(r.date) ? 1 : 0,
        });
      }
    }
    bank.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.account.localeCompare(b.account) || a.file.localeCompare(b.file));
    bank.forEach((r, i) => { r.id = 'BANK-' + ymd(r.date) + '-' + pad(i + 1, 4); });
    // duplicates
    const groups = new Map();
    for (const r of bank) { if (!groups.has(r.key)) groups.set(r.key, []); groups.get(r.key).push(r); }
    for (const g of groups.values()) {
      const ranked = [...g].sort((a, b) => b.srcMonthMatch - a.srcMonthMatch || a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
      for (const r of g) { r.dupCount = g.length > 1 ? g.length : null; r.dup = g.length > 1 && r !== ranked[0] ? 1 : 0; }
    }
    for (const r of bank) {
      const o = bankOvr.get(r.key);
      const ownName = r.cpKey ? own.get(r.cpKey) : null;
      const c = r.cpKey ? cpr.get(r.cpKey) : null;
      const ts = r.descKey && r.noteKey ? textSpecific.get(r.descKey + '|' + r.noteKey + '|' + r.flow) : null;
      const tg = r.descKey ? textGeneric.get(r.descKey + '|' + r.flow) : null;
      const pick = f => (o && o[f === 'bankType' ? 'bankType' : 'txType']) || null;
      r.ownName = ownName || null;
      r.cpName = c ? c.name : null;
      r.bankType = (o && o.bankType) || (ownName ? 'InternalTransfer' : null) || (c && c.bankType) || (ts && ts.bankType) || (tg && tg.bankType) || (r.flow === 'Inflow' ? 'UnclassifiedInflow' : 'UnclassifiedOutflow');
      r.type = (o && o.txType) || (ownName ? 'Transfer' : null) || (c && c.txType) || (ts && ts.txType) || (tg && tg.txType) || 'Pending';
      r.owner = (o && o.owner) || (c && c.owner) || (r.type === 'Income' ? '本人' : null);
      r.rule = o ? '手動覆寫' : ownName ? '自有帳戶' : c ? '對手方規則' : ts ? '文字規則' : tg ? '文字規則' : '待分類';
      r.memo = (o && o.memo) || (c && c.memo) || (ts && ts.memo) || (tg && tg.memo) || null;
      r.ledgerInclude = o && +o.ledgerInclude === 1 ? 1 : 0;
      r.include = r.type === 'Pending' || r.dup === 1 ? 0 : 1;
      void pick;
    }

    // ======================= LEDGER =======================
    const start = cfg.bankStart || '2026-08-01';
    const ledger = [];
    for (const r of app) {
      const keep = r.date < start || !['Income', 'Debt', 'Investment'].includes(r.type) ||
        (r.type === 'Debt' && r.main === '負債' && ['信貸本金', '機車貸款本金'].includes(r.sub));
      if (keep) ledger.push({ ...r, matchStatus: '未對帳' });
    }
    for (const r of bank) {
      if (r.include !== 1 || r.dup !== 0 || r.type === 'Pending') continue;
      if (!['Income', 'Debt', 'Investment'].includes(r.type)) continue;
      if (!(r.date >= start || r.ledgerInclude === 1)) continue;
      ledger.push({
        key: r.key, id: r.id, src: 'BANK', date: r.date, month: ym(r.date), book: r.account, bill: r.bankType,
        desc: r.memo || r.cpName || (r.cp ? r.cp : (r.note || '').trim() || r.desc), amount: Math.abs(r.amount), account: r.account,
        member: r.owner === '本人' ? '自己' : r.owner === '伴侶' ? '伴侶' : null, rawType: r.flow, type: r.type,
        main: r.type === 'Income' ? '收入' : null, sub: null, essential: null, fixed: null, life: 0, include: 1, dup: 0,
        matchStatus: r.date < start ? 'BANK歷史手動補入' : '不適用', note: r.note, flow: r.flow, bankType: r.bankType,
      });
    }
    // BANK expense not recorded in APP
    const appExp = app.filter(a => a.include === 1 && a.dup === 0 && a.type === 'Expense');
    const byAmt = new Map();
    for (const a of appExp) { const k = Math.round(Math.abs(a.gross ?? a.amount) * 100) / 100; if (!byAmt.has(k)) byAmt.set(k, []); byAmt.get(k).push(a); }
    const bankExp = bank.filter(b => b.include === 1 && b.dup === 0 && b.type === 'Expense');
    const cand = [];
    for (const b of bankExp) {
      const k = Math.round(Math.abs(b.amount) * 100) / 100;
      for (const a of byAmt.get(k) || []) if (Math.abs(dayDiff(b.date, a.date)) <= 2) cand.push({ b, a });
    }
    const bCnt = new Map(), aCnt = new Map();
    for (const c of cand) { bCnt.set(c.b, (bCnt.get(c.b) || 0) + 1); aCnt.set(c.a, (aCnt.get(c.a) || 0) + 1); }
    for (const b of bankExp) {
      const n = bCnt.get(b) || 0;
      const auto = cand.find(c => c.b === b && bCnt.get(c.b) === 1 && aCnt.get(c.a) === 1);
      b.expMatch = n === 0 ? '無APP候選' : auto ? '自動配對' : '需人工確認';
      b.expMatchApp = auto ? auto.a.key : null;
      b.expCandidates = cand.filter(c => c.b === b).map(c => c.a.key);
      if (b.expMatch === '無APP候選') {
        const pc = b.bankType === 'PersonalCarePayment';
        ledger.push({
          key: b.key, id: b.id, src: 'BANK', date: b.date, month: ym(b.date), book: b.account, bill: b.bankType,
          desc: pc ? '掏耳／美容保養' : b.memo || b.cp || b.desc, amount: Math.abs(b.amount), account: b.account, member: '自己',
          rawType: b.flow, type: 'Expense', main: pc ? '娛樂與個人享受' : null, sub: pc ? '美容/保養' : null, essential: pc ? '非必要' : null, fixed: pc ? '變動' : null,
          life: 1, include: 1, dup: 0, matchStatus: '無APP候選', note: 'BANK 支出：APP 無對應紀錄，自動補入總帳', bankType: b.bankType,
        });
      } else if (b.expMatch === '需人工確認') {
        issues.push({ type: 'BANK支出待確認', month: ym(b.date), ref: b.key, text: `${b.date} ${b.account} ${b.amount}：APP 有多筆同金額候選，未自動補入`, sev: 1 });
      }
    }
    // BANK-expense overrides for main category (ovr kind 'app' also applies to bank-expense ledger rows by key)
    for (const l of ledger) {
      if (l.src !== 'BANK') continue;
      const o = appOvr.get(l.key);
      if (!o) continue;
      if (o.main) l.main = o.main; if (o.sub !== undefined) l.sub = o.sub;
      if (o.essential !== undefined) l.essential = o.essential; if (o.fixed !== undefined) l.fixed = o.fixed;
      if (o.life != null && l.type === 'Expense') l.life = +o.life; l.edited = true;
    }
    // company meals etc. deducted from salary: the bank shows net pay, so add the deduction back as income
    const payroll = new Set((cfg.payrollAccounts || ['薪資扣款']).map(normApp));
    for (const r of [...ledger]) {
      if (r.type !== 'Expense' || !payroll.has(normApp(r.account))) continue;
      ledger.push({ key: 'PAY|' + r.key, id: 'PAY-' + r.id, src: 'PAYROLL', date: r.date, month: r.month, book: '薪資', bill: 'PayrollDeduction',
        desc: '薪資已扣：' + (r.desc || r.bill || ''), amount: r.gross ?? r.amount, account: r.account, member: '自己', rawType: '', type: 'Income',
        main: '收入', sub: '薪資扣款加回', essential: null, fixed: null, life: 0, include: 1, dup: 0, matchStatus: '不適用', note: '公司從薪水直接扣款，加回收入以呈現實際薪資' });
    }
    ledger.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));

    // ======================= RECEIVABLES (代墊款) =======================
    const receivables = [];
    for (const r of ledger) {
      if (r.share == null || r.gross == null) continue;
      const amt = Math.round((r.gross - r.share) * 100) / 100;
      if (amt <= 0) continue;
      const paid = settles.filter(st => st.recvKey === r.key).reduce((a, st) => a + (+st.amount || 0), 0);
      receivables.push({ key: r.key, date: r.date, month: r.month, desc: r.desc || r.bill, who: r.splitWith || '', total: r.gross, share: r.share, amount: amt, paid, open: Math.round((amt - paid) * 100) / 100,
        settlements: settles.filter(st => st.recvKey === r.key) });
    }

    // ======================= CARD RECON =======================
    const cardFiles = files.filter(f => f.kind === 'card').sort((a, b) => a.file.localeCompare(b.file));
    const card = [];
    const seenCard = new Set();
    for (const f of cardFiles) {
      const occ = new Map();
      for (const r of f.rows) {
        if (!r.date || r.amount == null) continue;
        const base = ['C', r.date, numText(r.amount), normApp(r.merchant)].join('|');
        const n = (occ.get(base) || 0) + 1; occ.set(base, n);
        const key = n > 1 ? base + '#' + n : base;
        if (seenCard.has(key)) continue; // same purchase in two exports
        seenCard.add(key);
        card.push({ key, file: f.file, date: r.date, month: ym(r.date), merchant: r.merchant, amount: r.amount, status: r.status || null, section: r.section || 'purchase', kind: r.kind || (/國外交易服務費|手續費|年費|循環利息|違約金/.test(r.merchant || '') ? 'fee' : (r.amount < 0 && /e\s*point|折抵/i.test(r.merchant || '')) ? 'points-credit' : 'purchase'), points: r.points || null, installment: r.installment || null, origCur: r.origCur || null, origAmt: r.origAmt ?? null });
      }
    }
    card.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    const cardAcct = normApp(cfg.cardAccount || '玉山 unicard');
    const appCard = app.filter(a => a.include === 1 && a.type === 'Expense' && normApp(a.account) === cardAcct);
    const amtOf = a => a.gross ?? a.amount;
    const manualPairs = ovr.filter(o => o.kind === 'cardmatch');
    const ignored = new Map(ovr.filter(o => o.kind === 'cardignore').map(o => [o.key, o]));
    const pairedApp = new Map(), pairedCard = new Map();
    const appByKey = new Map(appCard.map(a => [a.key, a])), cardByKey = new Map(card.map(c => [c.key, c]));
    const recon = [];
    // manual decisions (one card charge may cover several APP entries)
    for (const p of manualPairs) {
      const keys = p.appKeys || (p.appKey ? [p.appKey] : []);
      const as = keys.map(k => appByKey.get(k)).filter(Boolean), c = cardByKey.get(p.cardKey);
      if (!c || !as.length || pairedCard.has(c.key) || as.some(a => pairedApp.has(a.key))) continue;
      as.forEach(a => pairedApp.set(a.key, c.key)); pairedCard.set(c.key, keys);
      const diff = Math.round((c.amount - as.reduce((t, a) => t + amtOf(a), 0)) * 100) / 100;
      recon.push({ status: '成功配對', how: as.length > 1 ? '多筆合併' : '人工確認', app: as[0], apps: as, card: c, amountDiff: diff, adjusted: !!p.adjust });
      if (p.adjust && diff) {
        const a = as[0];
        ledger.push({ key: 'ADJ|' + c.key, id: 'ADJ-' + ymd(c.date), src: 'CARD', date: a.date, month: a.month, book: '信用卡', bill: '金額差額',
          desc: `帳單差額：${c.merchant}（帳單 ${c.amount}）`, amount: diff, account: a.account, member: '自己', rawType: '', type: 'Expense',
          main: a.main, sub: a.sub, essential: a.essential, fixed: a.fixed, life: a.life, include: 1, dup: 0, matchStatus: '帳單差額', note: 'APP 金額與信用卡帳單不同，補上差額' });
      }
    }
    // manual rows created from a card line ("補記") are paired to that line
    for (const a of appCard) if (a.cardKey && cardByKey.has(a.cardKey) && !pairedCard.has(a.cardKey) && !pairedApp.has(a.key)) {
      pairedApp.set(a.key, a.cardKey); pairedCard.set(a.cardKey, [a.key]);
      recon.push({ status: '成功配對', how: '補記', app: a, apps: [a], card: cardByKey.get(a.cardKey) });
    }
    const cardByAmt = new Map();
    for (const c of card) { if (!cardByAmt.has(c.amount)) cardByAmt.set(c.amount, []); cardByAmt.get(c.amount).push(c); }
    const cc = [];
    for (const a of appCard) {
      if (pairedApp.has(a.key)) continue;
      for (const c of cardByAmt.get(amtOf(a)) || []) if (!pairedCard.has(c.key) && Math.abs(dayDiff(c.date, a.date)) <= 2) cc.push({ a, c, d: dayDiff(c.date, a.date) });
    }
    const ac = new Map(), cn = new Map();
    for (const x of cc) { ac.set(x.a.key, (ac.get(x.a.key) || 0) + 1); cn.set(x.c.key, (cn.get(x.c.key) || 0) + 1); }
    const autoA = new Set(), autoC = new Set();
    for (const x of cc) if (ac.get(x.a.key) === 1 && cn.get(x.c.key) === 1) { recon.push({ status: '成功配對', how: '自動', app: x.a, apps: [x.a], card: x.c, diff: x.d }); autoA.add(x.a.key); autoC.add(x.c.key); }
    const amb = cc.filter(x => !autoA.has(x.a.key) && !autoC.has(x.c.key)).sort((p, q) => Math.abs(p.d) - Math.abs(q.d) || p.a.date.localeCompare(q.a.date));
    const sugA = new Set(), sugC = new Set();
    for (const x of amb) {
      if (sugA.has(x.a.key) || sugC.has(x.c.key)) continue;
      sugA.add(x.a.key); sugC.add(x.c.key);
      recon.push({ status: '需人工確認', how: '建議配對', app: x.a, apps: [x.a], card: x.c, diff: x.d });
    }
    // statement coverage: APP card rows dated between two exports' coverage are outside every statement
    const covers = cardFiles.map(f => { const ds = f.rows.map(r => r.date).filter(Boolean).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : null; }).filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
    const inGap = d => { if (!covers.length || d < covers[0][0] || d > covers[covers.length - 1][1]) return false; return !covers.some(([a, b]) => d >= a && d <= b); };
    const cardFeeStart = cfg.cardFeeStart || '2026-09';
    for (const a of appCard) if (!pairedApp.has(a.key) && !autoA.has(a.key) && !sugA.has(a.key)) {
      recon.push({ status: ignored.has(a.key) ? '已忽略' : inGap(a.date) ? '帳單期間外' : 'APP有卡無', app: a, apps: [a], card: null });
    }
    for (const c of card) if (!pairedCard.has(c.key) && !autoC.has(c.key) && !sugC.has(c.key)) {
      let status = ignored.has(c.key) ? '已忽略' : '卡有APP無';
      if (status === '卡有APP無') {
        if (c.kind === 'points-credit' || (c.points && c.points >= c.amount)) status = '點數折抵';
        else if (c.kind === 'fee' && c.month >= cardFeeStart) {
          status = '手續費入帳';
          ledger.push({ key: 'FEE|' + c.key, id: 'FEE-' + ymd(c.date), src: 'CARD', date: c.date, month: c.month, book: '信用卡', bill: '刷卡手續費',
            desc: c.merchant, amount: c.amount, account: cfg.cardAccount || '玉山 unicard', member: '自己', rawType: '', type: 'Expense',
            main: '金融手續費', sub: c.merchant.includes('國外') ? '海外交易手續費' : '手續費', essential: '非必要', fixed: '變動', life: 1, include: 1, dup: 0, matchStatus: '帳單自動入帳', note: '信用卡帳單上的手續費，APP 通常不會記' });
        }
      }
      recon.push({ status, app: null, apps: [], card: c });
    }
    ledger.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    for (const x of recon) x.month = x.app ? x.app.month : x.card.month;
    const cardMonths = new Set(card.map(c => c.month));

    // ======================= ISSUES =======================
    for (const a of app) if (a.unmappedBook) issues.push({ type: '未分類帳本', month: a.month, ref: a.key, text: `帳本「${a.book}」沒有對照到正式帳本`, sev: 3 });
    for (const a of app) if (a.type === 'Expense' && a.life === 1 && !a.main) issues.push({ type: '未分類明細', month: a.month, ref: a.key, text: `${a.date} ${a.bill} ${a.amount}`, sev: 1 });
    for (const b of bank) if (b.type === 'Pending' && b.dup === 0) issues.push({ type: b.date >= start ? '銀行待分類' : '歷史銀行待分類', month: ym(b.date), ref: b.key, text: `${b.date} ${b.account} ${b.amount > 0 ? '+' : ''}${b.amount} ${b.desc} ${b.cp || b.note || ''}`, sev: b.date >= start ? 3 : 0 });

    return { app, bank, ledger, card, recon, receivables, cardMonths: [...cardMonths].sort(), issues };
  };

  // ------------------------------------------------------------ stats
  E.MAIN_CATS = ['餐飲', '住房', '交通與車輛', '日常生活', '健康醫療', '保險與法定費用', '家庭責任', '數位生產力', '教育成長', '娛樂與個人享受'];
  E.monthStats = function (ledger, m, debts) {
    const rows = ledger.filter(r => r.month === m && r.include === 1 && r.dup === 0);
    const sum = f => rows.filter(f).reduce((s, r) => s + r.amount, 0);
    const life = r => r.type === 'Expense' && r.life === 1;
    const income = sum(r => r.type === 'Income');
    const expense = sum(life);
    const cats = {};
    for (const c of E.MAIN_CATS) cats[c] = sum(r => life(r) && r.main === c);
    const unclassified = sum(r => life(r) && !r.main);
    const otherCats = {};
    for (const r of rows) if (life(r) && r.main && !E.MAIN_CATS.includes(r.main)) otherCats[r.main] = (otherCats[r.main] || 0) + r.amount;
    const debtCash = debts ? E.debtCashForMonth(debts, m) : 0;
    const oneOff = sum(r => r.type === 'Income' && r.src === 'BANK' && ['OtherIncome', 'Bonus'].includes(r.bill));
    return {
      month: m, income, expense, balance: income - expense, savingsRate: income ? (income - expense) / income : 0,
      essential: sum(r => life(r) && r.essential === '必要'), nonEssential: sum(r => life(r) && r.essential === '非必要'),
      fixed: sum(r => life(r) && r.fixed === '固定'), variable: sum(r => life(r) && r.fixed === '變動'),
      cats, otherCats, unclassified, debtCash, free: income - expense - debtCash, oneOffIncome: oneOff,
      investFlow: sum(r => r.type === 'Investment'), count: rows.length,
    };
  };

  // last known balance per bank account (sum of sub-accounts) as of month end
  E.balances = function (files, m) {
    const end = m + '-31';
    const last = new Map();
    for (const f of files) {
      if (f.kind !== 'bank') continue;
      for (const r of f.rows) {
        if (r.bal == null || !r.date || r.date > end) continue;
        const k = f.account + '|' + (f.acctNo || '');
        const stamp = r.date + (r.time || '');
        const cur = last.get(k);
        if (!cur || stamp >= cur.stamp) last.set(k, { stamp, bal: r.bal, account: f.account, acctNo: f.acctNo, date: r.date });
      }
    }
    const out = {};
    for (const v of last.values()) { (out[v.account] ||= { total: 0, parts: [] }); out[v.account].total += v.bal; out[v.account].parts.push(v); }
    return out;
  };
  E.latestInvest = files => files.filter(f => f.kind === 'invest').sort((a, b) => String(b.asOf || b.file).localeCompare(String(a.asOf || a.file)))[0] || null;
  E.cardStatement = (files, m) => files.filter(f => f.kind === 'card' && f.month === m && f.statementTotal != null)[0] || null;

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.FinEngine = E;
})(typeof window !== 'undefined' ? window : globalThis);
