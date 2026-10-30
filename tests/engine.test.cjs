// Synthetic records only — never put real ledger data in this public repository.
const assert = require('assert');
const E = require('../engine.js');

// --- parsers
const app = E.parseApp('2030-01_餐飲.xlsx', [
  ['日期', '帳單', '金額', '類型', '成員', '帳戶', '帳本', '備註'], [null, null, null, null, null, null, null, null],
  ['2030-01-05', '正餐', 120, '支出', '自己', '測試卡', '餐飲', '便當'],
  ['2030-01-06', '代墊款回收', 50, '收入', '自己', '現金', '餐飲', '朋友還錢'],
  ['2030-02-01', '正餐', 99, '支出', '自己', '現金', '餐飲', '跨月'],
  ['2030-01-01 to 2030-01-31', null, null, null, null, null, null, null],
]);
assert.strictEqual(app.month, '2030-01'); assert.strictEqual(app.book, '餐飲'); assert.strictEqual(app.rows.length, 4);

const esun = E.parseBankEsun('2030-01_測試.xlsx', [['s', [
  ['帳號', '000111222333 臺幣綜存'], [],
  ['交易日期', '交易時間', '摘要', '提', '手續費', '存', '帳戶餘額', '存摺備註', '銀行代號/帳號', '轉帳留言'],
  ['*2030/01/10', '10:00:00', 'ＡＴＭ跨行轉', null, 15, '1,000', '5,000', '他行', '999/0000000000123456', null],
  ['2030/01/11', 0.5, '薪資', null, null, 30000, 35000, '公司', null, null],
  ['提醒您'],
]]]);
assert.strictEqual(esun.rows.length, 2);
assert.strictEqual(esun.rows[0].in, 1000); assert.strictEqual(esun.rows[0].fee, 15); assert.strictEqual(esun.rows[1].time, '120000');

const card = E.parseCardEsun('2030-12_測試unicard.xlsx', [['s', [
  ['本期消費明細:'], ['卡號:1234-XXXX-XXXX-9999(測試-正卡)'],
  ['12/30 01/02 測試商店 TWD 120 S'], ['01/02 01/04 海外商店 US 01/03 USD 10 TWD 320'], ['使用點數折抵'],
  ['本期應繳總金額: TWD 440'],
]]]);
assert.deepStrictEqual(card.rows.map(r => [r.date, r.amount]), [['2030-12-30', 120], ['2031-01-02', 320]]);
assert.strictEqual(card.statementTotal, 440);

// --- ledger
const config = {
  bankStart: '2030-01-08', cardAccount: '測試卡',
  ownAccounts: [{ cp: '999/123456', name: '自己的帳戶' }], cpRules: [],
  textRules: [{ desc: '薪資', flow: 'Inflow', bankType: 'SalaryIncome', txType: 'Income' }],
  bankOverrides: [], appMap: [{ book: '餐飲', main: '餐飲', txType: 'Expense', life: 1 }],
  detailMap: [{ main: '餐飲', sub: '正餐', essential: '必要', fixed: '變動', old: '正餐' }],
  specialRules: [{ book: '餐飲', ledger: '餐飲', bill: '代墊款回收', type: '收入', main: '餐飲', txType: 'Expense', life: 1 }],
  splits: [], debts: [{ name: '測試貸款', type: '信貸', principal: 120000, rate: 0.12, n: 12, start: '2030-01' }],
};
const files = [app, esun, { kind: 'card', file: 'c', month: '2030-01', rows: [{ date: '2030-01-06', merchant: 'A', amount: 120 }] }];
const res = E.compute({ files, config, ovr: [], manual: [] });
const s = E.monthStats(res.ledger, '2030-01', config.debts);
assert.strictEqual(s.income, 30000, 'salary from bank counts as income');
assert.strictEqual(s.expense, 70, 'expense 120 minus 50 reimbursement');
assert.strictEqual(res.bank.find(b => b.amount === 1000).type, 'Transfer', 'own account transfer');
assert.strictEqual(res.recon.filter(x => x.status === '成功配對').length, 1, 'card auto-match within 2 days');
assert.ok(res.issues.some(i => i.type === 'APP資料異常'), 'out-of-month row is flagged');
const d = E.debtStatus(config.debts[0], '2030-12');
assert.ok(Math.abs(d.payment - 10661.85) < 0.1 && d.balance === 0, 'amortised loan');

// --- 代墊 (share) + settlement, payroll deduction, multi-match with adjustment, card fees and points
const manual = [
  { id: 'm1', date: '2030-01-09', amount: 4000, desc: '旅館 4 人', account: '測試卡', txType: 'Expense', main: '餐飲', myShare: 2000, splitWith: '朋友' },
  { id: 'm2', date: '2030-01-10', amount: 300, desc: '公司訂餐', account: '薪資扣款', txType: 'Expense', main: '餐飲' },
];
const cardF = { kind: 'card', file: 'c2', month: '2030-01', rows: [
  { date: '2030-01-05', merchant: 'A', amount: 120 }, { date: '2030-01-09', merchant: '旅館', amount: 4000 },
  { date: '2030-01-12', merchant: '國外交易服務費', amount: 30, kind: 'fee' }, { date: '2030-01-12', merchant: '電信', amount: 99, points: 99 },
] };
const appF = E.parseApp('2030-01_餐飲.xlsx', [['日期', '帳單', '金額', '類型', '成員', '帳戶', '帳本', '備註'],
  ['2030-01-05', '正餐', 120, '支出', '自己', '測試卡', '餐飲', '便當'], ['2030-01-20', '代墊款回收', 2000, '收入', '自己', '現金', '餐飲', '朋友還旅館'],
  ['2030-01-14', '正餐', 60, '支出', '自己', '測試卡', '餐飲', '飯'], ['2030-01-14', '飲料', 41, '支出', '自己', '測試卡', '餐飲', '茶']]);
cardF.rows.push({ date: '2030-01-14', merchant: '餐廳', amount: 100 });
const repay = appF.rows.length && E.compute({ files: [appF, cardF], config: { ...config, cardFeeStart: '2030-01' }, ovr: [], manual }).app.find(a => a.bill === '代墊款回收').key;
const twoApps = E.compute({ files: [appF, cardF], config: { ...config, cardFeeStart: '2030-01' }, ovr: [], manual }).app.filter(a => a.date === '2030-01-14').map(a => a.key);
const res2 = E.compute({ files: [appF, cardF], config: { ...config, cardFeeStart: '2030-01' }, manual, ovr: [
  { kind: 'settle', recvKey: 'M|m1', txKey: repay, amount: 2000 },
  { kind: 'cardmatch', appKeys: twoApps, cardKey: res => res, adjust: true },
] });
const s2 = E.monthStats(res2.ledger, '2030-01', []);
assert.strictEqual(res2.receivables[0].amount, 2000); assert.strictEqual(res2.receivables[0].open, 0, 'repayment settles receivable');
assert.strictEqual(s2.income, 300, 'payroll deduction added back as income');
assert.ok(res2.recon.some(x => x.status === '手續費入帳') && res2.recon.some(x => x.status === '點數折抵'));
// expense = 120 + my share 2000 + 300 meal + 101 (60+41) + 30 fee ; repayment no longer reduces expense
const card100 = res2.card.find(c => c.amount === 100).key;
const res3 = E.compute({ files: [appF, cardF], config: { ...config, cardFeeStart: '2030-01' }, manual, ovr: [{ kind: 'settle', recvKey: 'M|m1', txKey: repay, amount: 2000 }, { kind: 'cardmatch', appKeys: twoApps, cardKey: card100, adjust: true }] });
const s3 = E.monthStats(res3.ledger, '2030-01', []);
assert.strictEqual(s3.expense, 120 + 2000 + 300 + 101 - 1 + 30, 'multi-match adjustment of -1 applied');
assert.ok(res3.recon.some(x => x.how === '多筆合併'));
// Stock Claude snapshot: buckets, partial sell cost, fx, binance/bank latest
{
  const sc = E.parseInvestAny('sc', { schema: 'stock-claude', version: 1, fx: { USDTWD: { rate: 30 } }, meta: { updatedAt: '2030-01-02T00:00:00+08:00' },
    quotes: { AAA: { price: 20, asOf: '2030-01-03T00:00:00+08:00' }, '1234': { price: 50 } },
    trades: [
      { date: '2030-01-01', bucket: 'long', ticker: 'AAA', currency: 'USD', side: 'BUY', qty: 10, price: 10, fee: 0, tax: 0, fx: 31 },
      { date: '2030-01-02', bucket: 'long', ticker: 'AAA', currency: 'USD', side: 'SELL', qty: 5, price: 12, fee: 0, tax: 0, fx: 31 },
      { date: '2030-01-01', bucket: 'swing', ticker: '1234', market: 'TW', currency: 'TWD', side: 'BUY', qty: 1000, price: 40, fee: 57, tax: 0, fx: 1 },
      { date: '2030-01-01', bucket: 'swing', ticker: 'ZZZ', currency: 'USD', side: 'BUY', qty: 1, price: 5, fee: 0, tax: 0, fx: 31 },
      { date: '2030-01-02', bucket: 'swing', ticker: 'ZZZ', currency: 'USD', side: 'SELL', qty: 1, price: 6, fee: 0, tax: 0, fx: 31 }],
    binance: { snapshots: [{ date: '2030-01-01', totalTwd: 100 }, { date: '2030-01-02', totalTwd: 200 }] },
    bank: { snapshots: [{ date: '2030-01-02', balance: 999 }, { date: '2030-01-01', balance: 1 }] } });
  const a = sc.holdings.find(h => h.ticker === 'AAA'), tw = sc.holdings.find(h => h.ticker === '1234');
  assert.strictEqual(sc.holdings.length, 2, 'closed position dropped');
  assert.strictEqual(a.account, '長期'); assert.strictEqual(a.costTwd, 1550); assert.strictEqual(a.mvTwd, 3000);
  assert.strictEqual(tw.account, '波段'); assert.strictEqual(tw.costTwd, 40057); assert.strictEqual(tw.mvTwd, 50000);
  assert.strictEqual(sc.external[0].mvTwd, 200); assert.strictEqual(sc.brokerCashTwd, 999);
  assert.strictEqual(sc.asOf, '2030-01-02T16:00:00.000Z');
  assert.strictEqual(E.detectKind('stock-claude-2030-01-03.json'), 'invest');
}
// 電子發票 QR：左碼＋右碼、Big5 品名、Base64 品名
{
  const head = 'AB11223344' + '1151017' + '1234' + '00000064' + '00000069' + '00000000' + '12345678' + 'ydXZt4LAN1UHN/j1juVcRA==';
  assert.strictEqual(head.length, 77);
  const p = E.parseInvoiceQR([head + ':**********:2:3:1:拿鐵:1:65:麵包:1:40', '**:茶葉蛋:2:12']);
  assert.strictEqual(p.inv, 'AB11223344'); assert.strictEqual(p.date, '2026-10-17'); assert.strictEqual(p.amount, 105); assert.strictEqual(p.untaxed, 100);
  assert.strictEqual(p.seller, '12345678'); assert.strictEqual(p.buyer, null); assert.deepStrictEqual(p.items.map(i => i.name), ['拿鐵', '麵包', '茶葉蛋']);
  assert.strictEqual(E.invoiceDesc(p), '拿鐵 等 3 項');
  const big5 = Buffer.concat([Buffer.from(head + ':**********:1:1:0:'), Buffer.from([0xa9, 0x40, 0xb0, 0xd8]), Buffer.from(':1:65')]);
  assert.strictEqual(E.parseInvoiceQR(E.decodeInvoiceQRs([{ bytes: [...big5] }])).items[0].name, '咖啡');
  const b64 = E.parseInvoiceQR([head + ':**********:1:1:2:' + Buffer.from('便當').toString('base64') + ':1:105']);
  assert.strictEqual(b64.items[0].name, '便當');
  assert.strictEqual(E.parseInvoiceQR(['https://example.com']), null);
  assert.strictEqual(E.parseInvoiceQR([head.replace('1151017', '1151399')]), null);
}
// 載具發票 CSV：分組加總、折讓、註腳、配對（同日、網購晚開、金額接近）
{
  const csv = '\uFEFF載具自訂名稱,發票日期,發票號碼,發票金額,發票狀態,折讓,賣方統一編號,賣方名稱,賣方地址,買方統編,消費明細_數量,消費明細_單價,消費明細_金額,消費明細_品名\n' +
    '手機條碼,20300105,AA00000001,100,開立已確認,否,11111111,全聯實業股份有限公司竹北分公司,"竹北市,中正路",,1,100,100,豆漿\n' +
    '手機條碼,20300105,AA00000001,-10,開立已確認,否,11111111,全聯實業股份有限公司竹北分公司,"竹北市,中正路",,1,-10,-10,折讓\n' +
    '手機條碼,20300110,AA00000002,500,開立已確認,否,22222222,明豪企業有限公司,高雄,,1,500,500,口罩\n' +
    '手機條碼,20300112,AA00000003,1186,開立已確認,否,33333333,五味瓶美食股份有限公司,竹北,,1,1186,1186,鍋\n' +
    '手機條碼,20300115,AA00000004,77,開立已確認,否,44444444,凱竹商行,竹北,,1,77,77,綠茶\n' +
    '捐贈或作廢之發票，字軌號碼均會隱末3碼\n';
  const doc = E.parseEinvoiceCSV('123_456.csv', csv);
  assert.strictEqual(doc.file, '2030-01_載具發票.csv'); assert.strictEqual(doc.rows.length, 4);
  assert.strictEqual(doc.rows[0].total, 90); assert.strictEqual(doc.rows[0].store, '全聯'); assert.strictEqual(doc.rows[0].address, '竹北市,中正路');
  assert.strictEqual(E.detectKind('7262032_20261017015440.csv'), 'einvoice');
  const ef = { ...doc, _id: 'einvoice.2030-01.x' };
  const app = E.parseApp('2030-01_餐飲.xlsx', [['日期', '帳單', '金額', '類型', '成員', '帳戶', '帳本', '備註'],
    ['2030-01-06', '正餐', 90, '支出', '自己', '現金', '餐飲', '全聯'], ['2030-01-07', '正餐', 500, '支出', '自己', '現金', '餐飲', '口罩'], ['2030-01-12', '正餐', 1174, '支出', '自己', '現金', '餐飲', '火鍋']]);
  const r = E.compute({ files: [app, ef], config, ovr: [], manual: [] });
  const st = Object.fromEntries(r.einv.map(x => [x.inv, x.status]));
  assert.strictEqual(st.AA00000004, '帳上找不到');
  {
    assert.strictEqual(st.AA00000001, '已對上');
    assert.strictEqual(st.AA00000002, '已對上', 'online order 3 days late, unique amount');
    assert.strictEqual(st.AA00000003, '待確認');
    const sug = r.einv.find(x => x.inv === 'AA00000003').suggest;
    const r2 = E.compute({ files: [app, ef], config, ovr: [{ kind: 'einv', inv: 'AA00000003', action: 'link', key: sug }, { kind: 'einv', inv: 'AA00000004', action: 'ignore' }], manual: [] });
    assert.strictEqual(r2.einv.find(x => x.inv === 'AA00000003').status, '已對上'); assert.strictEqual(r2.einv.find(x => x.inv === 'AA00000004').status, '已忽略');
    assert.strictEqual(r2.ledger.find(x => x.key === sug).store, '五味瓶美食');
  }
  const r3 = E.compute({ files: [ef], config, ovr: [], manual: [{ id: 'm9', date: '2030-01-20', amount: 77, desc: 'x', main: '餐飲', inv: 'AA00000004' }] });
  assert.strictEqual(r3.einv.find(x => x.inv === 'AA00000004').status, '已對上', 'same invoice number links even with date gap');
  assert.strictEqual(r.app.length, 3, 'test app rows parsed');
}
// 發票狀態：紙本／無發票不拿來猜配對；標載具但雲端沒有的會被列出
{
  const csv2 = '\uFEFF載具自訂名稱,發票日期,發票號碼,發票金額,發票狀態,折讓,賣方統一編號,賣方名稱,賣方地址,買方統編,消費明細_數量,消費明細_單價,消費明細_金額,消費明細_品名\n' +
    '手機條碼,20300301,BB00000001,120,開立已確認,否,55555555,早餐店,竹北,,1,120,120,蛋餅\n' +
    '手機條碼,20300320,BB00000002,60,開立已確認,否,66666666,飲料店,竹北,,1,60,60,紅茶\n';
  const f2 = { ...E.parseEinvoiceCSV('x.csv', csv2), _id: 'einvoice.2030-03.x' };
  const mk = (id, date, amount, receipt) => ({ id, date, amount, desc: id, main: '餐飲', receipt });
  // 紙本那筆同金額同天，不能搶走載具發票；載具那筆才是對上的
  const r = E.compute({ files: [f2], config, ovr: [], manual: [mk('paper1', '2030-03-01', 120, 'paper'), mk('car1', '2030-03-02', 120, 'carrier')] });
  const x = r.einv.find(e => e.inv === 'BB00000001');
  assert.strictEqual(x.status, '已對上'); assert.strictEqual(x.match, 'M|car1', 'paper-marked row is not used for carrier matching');
  // 只有紙本那筆時，發票列為帳上找不到（不會被紙本誤配）
  const r2 = E.compute({ files: [f2], config, ovr: [], manual: [mk('paper1', '2030-03-01', 120, 'paper'), mk('none1', '2030-03-01', 120, 'none')] });
  assert.strictEqual(r2.einv.find(e => e.inv === 'BB00000001').status, '帳上找不到');
  // 反向：標載具但雲端沒有 → 列出；CSV 最後一天前 3 天內的先不列；紙本、未標記的不列
  const r3 = E.compute({ files: [f2], config, ovr: [], manual: [mk('c-old', '2030-03-10', 999, 'carrier'), mk('c-new', '2030-03-18', 888, 'carrier'), mk('p', '2030-03-10', 777, 'paper'), mk('legacy', '2030-03-10', 666)] });
  assert.deepStrictEqual(r3.einvMissing, ['M|c-old']);
  assert.strictEqual(r3.app.find(a => a.key === 'M|legacy').receipt, null, 'old records without the field stay unmarked');
}
// 標記重複：不計入收支、預算、卡片對帳
{
  const k = res2.app.find(a => a.date === '2030-01-05' && a.src === 'APP').key;
  const before = E.monthStats(res2.ledger, '2030-01', []).expense;
  const r4 = E.compute({ files: [appF, cardF], config: { ...config, cardFeeStart: '2030-01' }, manual, ovr: [{ kind: 'app', key: k, exclude: '重複' }] });
  assert.strictEqual(r4.app.find(a => a.key === k).include, 0);
  assert.ok(E.monthStats(r4.ledger, '2030-01', []).expense < E.monthStats(E.compute({ files: [appF, cardF], config: { ...config, cardFeeStart: '2030-01' }, manual, ovr: [] }).ledger, '2030-01', []).expense, 'excluded row drops out of expense');
  void before;
}
// 餐費額度：單日超過日常上限的部分算加菜；零用金算日常；食材不算
{
  const plan = { daily: 800, extra: 6000, allowanceSub: '青穎餐費' };
  const L = [
    { date: '2030-05-01', month: '2030-05', type: 'Expense', life: 1, include: 1, dup: 0, main: '餐飲', sub: '正餐', desc: '早餐', amount: 200 },
    { date: '2030-05-01', month: '2030-05', type: 'Expense', life: 1, include: 1, dup: 0, main: '餐飲', sub: '正餐', desc: '火鍋', amount: 1800 },
    { date: '2030-05-02', month: '2030-05', type: 'Expense', life: 1, include: 1, dup: 0, main: '餐飲', sub: '正餐', desc: '便當', amount: 500 },
    { date: '2030-05-02', month: '2030-05', type: 'Expense', life: 1, include: 1, dup: 0, main: '餐飲', sub: '食材', desc: 'costco', amount: 3000 },
    { date: '2030-05-03', month: '2030-05', type: 'Expense', life: 1, include: 1, dup: 0, main: '餐飲', sub: null, desc: '青穎餐費', amount: 1000 },
  ];
  const st = E.mealPlanStatus(L, plan, '2030-05', '2030-05-02');
  assert.strictEqual(st.extra, 1200); assert.strictEqual(st.normal, 1300); assert.strictEqual(st.allowance, 1000); assert.strictEqual(st.today, 500);
  assert.strictEqual(st.extraLeft, 4800);
  const p1 = E.mealPlanProbe(st, plan, { date: '2030-05-02', type: 'Expense', life: 1, include: 1, main: '餐飲', sub: '正餐', desc: '晚餐', amount: 600 });
  assert.strictEqual(p1.after, 1100); assert.strictEqual(p1.add, 300); assert.strictEqual(p1.extraLeft, 4500);
  assert.ok(E.mealPlanProbe(st, plan, { date: '2030-05-02', type: 'Expense', life: 1, include: 1, main: '餐飲', sub: '青穎餐費', desc: '', amount: 1000 }).allowance);
  assert.strictEqual(E.mealPlanStatus(L, null, '2030-05', '2030-05-02'), null);
}
// 旅行：外幣記帳＋刷卡依原幣自動配對、差額補上；彙總
{
  const trip = { id: 't1', name: '日本', start: '2030-06-01', end: '2030-06-05', cur: 'JPY', rate: 0.2, cashAccount: '日幣現金', on: true };
  const manual = [
    { id: 'j1', date: '2030-06-02', amount: 200, fx: { cur: 'JPY', amt: 1000, rate: 0.2 }, desc: '拉麵', account: '測試卡', txType: 'Expense', main: '娛樂與個人享受', sub: '旅遊', trip: 't1', tripCat: '餐飲' },
    { id: 'j2', date: '2030-06-03', amount: 400, fx: { cur: 'JPY', amt: 2000, rate: 0.2 }, myShare: 200, desc: '車票4人', account: '日幣現金', txType: 'Expense', main: '娛樂與個人享受', sub: '旅遊', trip: 't1', tripCat: '交通' },
  ];
  const cardJ = { kind: 'card', file: 'cj', month: '2030-06', rows: [{ date: '2030-06-04', merchant: 'RAMEN TOKYO', amount: 212, origCur: 'JPY', origAmt: 1000 }, { date: '2030-06-04', merchant: '國外交易服務費', amount: 3, kind: 'fee' }] };
  const r = E.compute({ files: [cardJ], config: { ...config, cardFeeStart: '2030-01' }, ovr: [], manual });
  const rc = r.recon.find(x => x.how === '外幣刷卡');
  assert.ok(rc, 'foreign card charge auto-matched by original amount'); assert.strictEqual(rc.amountDiff, 12);
  assert.ok(r.ledger.some(x => x.matchStatus === '匯率差額' && x.amount === 12 && x.trip === 't1'));
  const sm = E.tripSummary(r.ledger, trip);
  assert.strictEqual(sm.mine, 200 + 12 + 200 + 3); assert.strictEqual(sm.others, 200); assert.strictEqual(sm.cashFx, 2000);
  assert.strictEqual(sm.by['餐飲'], 212); assert.strictEqual(sm.by['手續費'], 3);
  assert.ok(E.tripActive(trip, '2030-06-05') && !E.tripActive(trip, '2030-06-06'));
}
// 可能記錯：同日同金額同描述、金額差 5 倍、沒描述的大額
{
  const mk = (k, date, desc, amount, src = 'MANUAL') => ({ key: k, src, date, month: date.slice(0, 7), desc, amount, type: 'Expense', include: 1 });
  const L = [mk('a', '2030-07-01', '燻雞', 100), mk('b', '2030-07-02', '燻雞', 100), mk('c', '2030-07-03', '燻雞', 100), mk('d', '2030-07-04', '燻雞', 1000),
    mk('e', '2030-07-05', '高鐵', 640), mk('f', '2030-07-05', '高鐵', 640), mk('g', '2030-07-06', '', 1620)];
  const r = E.auditMonth(L, '2030-07', []);
  assert.deepStrictEqual(r.map(x => x.kind + ':' + x.key).sort(), ['dup:f', 'nodesc:g', 'outlier:d']);
  assert.strictEqual(E.auditMonth(L, '2030-07', [{ kind: 'auditok', key: 'f' }]).length, 2);
}
// 出發前買的、舊 APP 紀錄也能算進旅行
{
  const trip = { id: 't9', name: '日本', start: '2030-08-10', end: '2030-08-15', cur: 'JPY', rate: 0.2, on: true };
  const appT = E.parseApp('2030-08_餐飲.xlsx', [['日期', '帳單', '金額', '類型', '成員', '帳戶', '帳本', '備註'], ['2030-08-01', '正餐', 300, '支出', '自己', '現金', '餐飲', '藥妝先買']]);
  const k = E.compute({ files: [appT], config, ovr: [], manual: [] }).app[0].key;
  const r = E.compute({ files: [appT], config, ovr: [{ kind: 'app', key: k, trip: 't9', tripCat: '藥妝' }], manual: [{ id: 'p1', date: '2030-07-20', amount: 5000, desc: '機票', main: '娛樂與個人享受', sub: '旅遊', trip: 't9', tripCat: '交通' }] });
  const sm = E.tripSummary(r.ledger, trip);
  assert.strictEqual(sm.mine, 5300); assert.strictEqual(sm.by['藥妝'], 300); assert.strictEqual(sm.by['交通'], 5000);
  assert.strictEqual(E.util.addDays('2030-08-10', -120), '2030-04-12');
}
// 金額欄的四則運算
{
  const c = E.calcAmount;
  assert.strictEqual(c('1200+800'), 2000); assert.strictEqual(c('6400÷4'), 1600); assert.strictEqual(c('3×250'), 750);
  assert.strictEqual(c('(500+300)*2'), 1600); assert.strictEqual(c('1,200'), 1200); assert.strictEqual(c('100-30'), 70);
  assert.strictEqual(c('10/3'), 3.33); assert.strictEqual(c(''), null); assert.ok(isNaN(c('12+')) && isNaN(c('abc')) && isNaN(c('1/0')));
  assert.strictEqual(c('1200='), 1200); assert.ok(E.isFormula('1+2') && !E.isFormula('-5') && !E.isFormula('120'));
}
{ // 代墊對象：解析、每人收回
  const P = (t, a, r) => E.parseWho(t, a, r).map(x => [x.who, x.amt]);
  assert.deepStrictEqual(P('旅伴：彤新', 500), [['彤新', 500]]);
  assert.deepStrictEqual(P('旅伴：青穎媽媽2139；彤新3792', 5931), [['青穎媽媽', 2139], ['彤新', 3792]]);
  assert.deepStrictEqual(P('彤新2323（¥11382）；青穎媽媽1221（¥5984）', 3544), [['彤新', 2323], ['青穎媽媽', 1221]]);
  assert.deepStrictEqual(P('朋友 2,000', 2000), [['朋友', 2000]]);
  assert.deepStrictEqual(P('租車公司（訂錯，待退款）', 2028), [['租車公司', 2028]]);
  assert.deepStrictEqual(P('彤新4500¥；表哥', 1263, 0.2041), [['彤新', 918], ['表哥', 345]]);
  assert.deepStrictEqual(P('阿明、小美', 1000), [['阿明', 500], ['小美', 500]]);
  const pp = E.recvPeople([{ who: 'A', amt: 300 }, { who: 'B', amt: 700 }], null, 1000, null, [{ who: 'B', amount: 700 }, { amount: 100 }]);
  assert.deepStrictEqual(pp.map(p => [p.who, p.open]), [['A', 270], ['B', -70]]);
  const rv = [{ key: 'x', trip: 't', open: 1000, people: E.recvPeople(null, 'A 600；B', 1000, null, []) }, { key: 'y', trip: null, open: 50, people: E.recvPeople(null, 'B', 50, null, []) }];
  const g = E.peopleOwe(rv); assert.deepStrictEqual(g.map(x => [x.who, x.open, x.count]), [['A', 600, 1], ['B', 450, 2]]);
  assert.deepStrictEqual(E.peopleOwe(rv, r => r.trip === 't').map(x => x.who), ['A', 'B']);
}
{ // 旅行退稅
  const trip = { id: 't1', start: '2026-10-28', end: '2026-11-02', cashAccount: '日幣現金' };
  const L = [{ include: 1, type: 'Expense', trip: 't1', amount: 1000, gross: 1000, tripCat: '藥妝', account: '卡', fx: { amt: 5000 } },
    { include: 1, type: 'Income', trip: 't1', amount: 100, gross: 100, account: '日幣現金', fx: { amt: 490 } }];
  const sm = E.tripSummary(L, trip);
  assert.strictEqual(sm.mine, 900); assert.strictEqual(sm.refund, 100); assert.strictEqual(sm.cashFx, -490); assert.strictEqual(sm.by['退稅／退款'], -100); assert.strictEqual(sm.count, 2);
}
console.log('engine tests passed');
