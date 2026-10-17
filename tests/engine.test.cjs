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
console.log('engine tests passed');
