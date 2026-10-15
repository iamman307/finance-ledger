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
console.log('engine tests passed');
