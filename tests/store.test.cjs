// GitStore：大檔案讀取與「不完整資料不覆蓋」保險。用假的 fetch / localStorage 跑。
const assert = require('assert');
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };
require('../store.js');
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const STATE = JSON.stringify({ config: { main: { budgets: [] } }, ovr: {}, manual: { m1: { date: '2026-11-01', amount: 100, desc: '午餐' } }, nw: {} });

function fakeGitHub({ big, blobBroken }) {
  const puts = [];
  globalThis.fetch = async (url, opts = {}) => {
    const p = url.replace('https://api.github.com/repos/o/r', '').split('?')[0];
    const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body });
    if ((opts.method || 'GET') === 'PUT') { puts.push({ p, text: Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8') }); return json(200, { content: { sha: 'new' } }); }
    if (p === '/contents/raw') return json(200, []);
    if (p === '/contents/state.json') return json(200, big ? { path: 'state.json', sha: 's1', size: STATE.length, content: '', encoding: 'none' } : { path: 'state.json', sha: 's1', size: STATE.length, content: b64(STATE), encoding: 'base64' });
    if (p === '/git/blobs/s1') return blobBroken ? json(500, { message: 'boom' }) : json(200, { content: b64(STATE), encoding: 'base64' });
    return json(404, {});
  };
  return puts;
}
const flushNow = async s => { clearTimeout(s.timer); await s.flush(); };

(async () => {
  { // 一般大小：照常讀
    mem.clear(); fakeGitHub({});
    const s = new GitStore({ owner: 'o', repo: 'r', token: 't' }); await s.load();
    assert.strictEqual(s.docs.get('manual/m1').desc, '午餐'); assert.ok(s.docs.has('config/main'));
  }
  { // 超過 1 MB（content 是空的）：改用 blobs 讀到完整內容
    mem.clear(); fakeGitHub({ big: true });
    const s = new GitStore({ owner: 'o', repo: 'r', token: 't' }); await s.load();
    assert.strictEqual(s.docs.get('manual/m1').amount, 100); assert.ok(s.docs.has('config/main'));
    await s.refresh(); assert.ok(s.docs.has('config/main'));
  }
  { // 讀不到完整內容：load 要失敗，不能當成空帳本
    mem.clear(); fakeGitHub({ big: true, blobBroken: true });
    const s = new GitStore({ owner: 'o', repo: 'r', token: 't' });
    await assert.rejects(() => s.load()); assert.strictEqual(s.docs.size, 0);
  }
  { // 保險：設定不見時拒絕寫出 state.json；正常時照常寫
    mem.clear(); const puts = fakeGitHub({});
    const s = new GitStore({ owner: 'o', repo: 'r', token: 't' }); await s.load();
    const ok = s.doc('manual/m2').set({ date: '2026-11-02', amount: 50 }); await flushNow(s); await ok;
    assert.strictEqual(puts.length, 1); assert.ok(JSON.parse(puts[0].text).config.main);
    s.docs.delete('config/main'); // 模擬記憶體資料壞掉
    const bad = s.doc('manual/m3').set({ date: '2026-11-03', amount: 70 }); bad.catch(() => {}); await flushNow(s);
    await assert.rejects(() => bad, e => e.code === 'guard');
    assert.strictEqual(puts.length, 1, '不完整的資料不能寫回 GitHub');
    assert.ok(JSON.parse(mem.get('fin.pending')).some(o => o.path === 'manual/m3'), '沒存成功的編輯要留在這台裝置');
  }
  { // 全新的 repo（還沒有 state.json）：可以正常建立
    mem.clear(); const puts = fakeGitHub({});
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => (url.includes('/contents/state.json') && (opts.method || 'GET') === 'GET') ? { ok: false, status: 404, statusText: '404', json: async () => ({}) } : orig(url, opts);
    const s = new GitStore({ owner: 'o', repo: 'r', token: 't' }); await s.load();
    const p = s.doc('config/main').set({ budgets: [] }); await flushNow(s); await p;
    assert.strictEqual(puts.length, 1);
  }
  console.log('store tests passed');
})().catch(e => { console.error(e); process.exit(1); });
