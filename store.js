/* GitStore — keeps the ledger's data in a private GitHub repository.
   Layout in the data repo:
     state.json            { config:{main}, ovr:{id:doc}, manual:{id:doc}, nw:{id:doc} }   (small, edited often)
     raw/<YYYY-MM>.json    { <docId>: parsedFile, ... }                                    (imported source files)
   Exposes the subset of a document-store API the app uses:
     collection(name).onSnapshot(fn, err)   doc(path).onSnapshot/get/set/update/delete     */
(function (root) {
  'use strict';
  const API = 'https://api.github.com';
  const STATE_COLS = ['config', 'ovr', 'manual', 'nw'];

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const cacheGet = k => { try { return JSON.parse(localStorage.getItem('fin.c.' + k) || 'null'); } catch (e) { return null; } };
  const cachePut = (k, v) => { try { localStorage.setItem('fin.c.' + k, JSON.stringify(v)); } catch (e) { /* quota: ignore, cache is optional */ } };
  const rawFileOf = id => { const seg = String(id).split('.')[1] || 'misc'; return 'raw/' + (/^\d{4}-\d{2}$/.test(seg) ? seg : seg === '-' ? 'invest' : 'misc') + '.json'; };

  class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }

  class GitStore {
    constructor({ owner, repo, token, branch }) {
      this.owner = owner; this.repo = repo; this.token = token; this.branch = branch || 'main';
      this.docs = new Map();      // 'col/id' -> data
      this.files = new Map();     // repo path -> sha
      this.subs = new Set();
      this.dirty = new Map();     // repo path -> [{op, path, data}]
      this.timer = null; this.flushing = null;
      this.status = 'idle'; this.onStatus = null;
    }
    setStatus(s, detail) { this.status = s; if (this.onStatus) this.onStatus(s, detail); }
    async api(path, opts = {}) {
      const res = await fetch(API + `/repos/${this.owner}/${this.repo}` + path, {
        ...opts, cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + this.token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
      });
      if (res.status === 404 && (!opts.method || opts.method === 'GET')) return null;
      if (!res.ok) {
        let msg = res.statusText; try { msg = (await res.json()).message || msg; } catch (e) {}
        const code = res.status === 401 ? 'unauthenticated' : res.status === 403 ? 'forbidden' : res.status === 409 || res.status === 422 ? 'conflict' : 'unavailable';
        throw new StoreError(code, `GitHub ${res.status}：${msg}`);
      }
      return res.status === 204 ? null : res.json();
    }
    async checkAccess() {
      const r = await this.api('');
      if (!r) throw new StoreError('not_found', '找不到這個 repo，或 token 沒有它的權限');
      if (!r.private) throw new StoreError('public_repo', `${this.owner}/${this.repo} 是公開 repo，帳本資料只能放在 Private repo`);
      if (r.permissions && !r.permissions.push) throw new StoreError('forbidden', 'token 沒有寫入權限（Contents 要選 Read and write）');
      this.branch = r.default_branch || this.branch;
      return r;
    }
    async readFile(path, knownSha) {
      const c = cacheGet(path);
      if (knownSha && c && c.sha === knownSha) return { sha: c.sha, text: c.text };
      const r = await this.api(`/contents/${path}?ref=${encodeURIComponent(this.branch)}`);
      if (!r) return null;
      let text;
      if (r.content && r.encoding === 'base64') text = b64decode(r.content);
      else { const blob = await this.api(`/git/blobs/${r.sha}`); text = b64decode(blob.content); }
      cachePut(path, { sha: r.sha, text });
      return { sha: r.sha, text };
    }
    ingest(path, text) {
      const data = JSON.parse(text || '{}');
      if (path === 'state.json') {
        for (const k of [...this.docs.keys()]) if (STATE_COLS.includes(k.split('/')[0])) this.docs.delete(k);
        for (const col of STATE_COLS) for (const [id, d] of Object.entries(data[col] || {})) this.docs.set(col + '/' + id, d);
      } else {
        for (const k of [...this.docs.keys()]) if (k.startsWith('raw/') && rawFileOf(k.slice(4)) === path) this.docs.delete(k);
        for (const [id, d] of Object.entries(data)) this.docs.set('raw/' + id, d);
      }
    }
    async load() {
      this.setStatus('loading');
      const list = (await this.api(`/contents/raw?ref=${encodeURIComponent(this.branch)}`)) || [];
      const want = list.filter(f => f.type === 'file' && f.name.endsWith('.json'));
      const stateMeta = await this.api(`/contents/state.json?ref=${encodeURIComponent(this.branch)}`);
      const jobs = want.map(async f => { const r = await this.readFile(f.path, f.sha); if (r) { this.files.set(f.path, r.sha); this.ingest(f.path, r.text); } });
      if (stateMeta) { this.files.set('state.json', stateMeta.sha); this.ingest('state.json', b64decode(stateMeta.content)); cachePut('state.json', { sha: stateMeta.sha, text: b64decode(stateMeta.content) }); }
      for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6));
      this.setStatus('synced');
      this.emit();
    }
    loadFromCache() { // offline fallback
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (!k || !k.startsWith('fin.c.')) continue;
        const path = k.slice(6), c = cacheGet(path); if (c) { this.ingest(path, c.text); this.files.set(path, c.sha); n++; }
      }
      this.emit(); return n;
    }
    async refresh() { // pick up edits made on another device
      if (this.dirty.size || this.flushing) return;
      try {
        const meta = await this.api(`/contents/state.json?ref=${encodeURIComponent(this.branch)}`);
        let changed = false;
        if (meta && meta.sha !== this.files.get('state.json')) { this.files.set('state.json', meta.sha); this.ingest('state.json', b64decode(meta.content)); changed = true; }
        const list = (await this.api(`/contents/raw?ref=${encodeURIComponent(this.branch)}`)) || [];
        for (const f of list) if (f.type === 'file' && f.sha !== this.files.get(f.path)) { const r = await this.readFile(f.path, f.sha); if (r) { this.files.set(f.path, r.sha); this.ingest(f.path, r.text); changed = true; } }
        this.setStatus('synced');
        if (changed) this.emit();
      } catch (e) { this.setStatus('offline', e.message); }
    }
    emit() { for (const s of this.subs) { try { s(); } catch (e) { console.error(e); } } }
    snapshotOf(path) { const d = this.docs.get(path); return { id: path.split('/').pop(), exists: d !== undefined, data: () => d, metadata: { fromCache: false, hasPendingWrites: this.dirty.size > 0 } }; }
    collection(name) {
      const self = this;
      return {
        path: name,
        onSnapshot(next) {
          const run = () => { const docs = [...self.docs.keys()].filter(k => k.startsWith(name + '/') && k.split('/').length === 2).sort().map(k => self.snapshotOf(k)); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }); };
          self.subs.add(run); setTimeout(run, 0); return () => self.subs.delete(run);
        },
        doc(id) { return self.doc(name + '/' + id); },
      };
    }
    doc(path) {
      const self = this;
      return {
        id: path.split('/').pop(), path,
        onSnapshot(next) { const run = () => next(self.snapshotOf(path)); self.subs.add(run); setTimeout(run, 0); return () => self.subs.delete(run); },
        async get() { return self.snapshotOf(path); },
        set(data) { return self.write('set', path, JSON.parse(JSON.stringify(data))); },
        update(data) { if (!self.docs.has(path)) return Promise.reject(new StoreError('invalid_argument', '文件不存在')); return self.write('set', path, { ...self.docs.get(path), ...JSON.parse(JSON.stringify(data)) }); },
        delete() { return self.write('delete', path); },
      };
    }
    fileOf(path) { const [col, id] = path.split('/'); return col === 'raw' ? rawFileOf(id) : 'state.json'; }
    write(op, path, data) {
      if (op === 'set') this.docs.set(path, data); else this.docs.delete(path);
      const file = this.fileOf(path);
      if (!this.dirty.has(file)) this.dirty.set(file, []);
      this.dirty.get(file).push({ op, path, data });
      this.persistPending();
      this.emit();
      this.setStatus('saving');
      return new Promise((resolve, reject) => {
        (this.waiters ||= []).push({ resolve, reject });
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 700);
      });
    }
    persistPending() {
      try {
        const all = [...this.dirty.values()].flat().concat(this.inflight || []);
        if (all.length) localStorage.setItem('fin.pending', JSON.stringify(all)); else localStorage.removeItem('fin.pending');
      } catch (e) { /* storage full or blocked: edits stay in memory only */ }
    }
    restorePending() {
      let ops = []; try { ops = JSON.parse(localStorage.getItem('fin.pending') || '[]'); } catch (e) {}
      if (!ops.length) return 0;
      for (const o of ops) {
        if (o.op === 'set') this.docs.set(o.path, o.data); else this.docs.delete(o.path);
        const file = this.fileOf(o.path); if (!this.dirty.has(file)) this.dirty.set(file, []); this.dirty.get(file).push(o);
      }
      this.emit(); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(() => {}), 300);
      return ops.length;
    }
    serialize(file) {
      if (file === 'state.json') {
        const out = {}; for (const c of STATE_COLS) out[c] = {};
        for (const [k, d] of this.docs) { const [col, id] = k.split('/'); if (STATE_COLS.includes(col)) out[col][id] = d; }
        return JSON.stringify(out, null, 1);
      }
      const out = {};
      for (const [k, d] of [...this.docs].sort((a, b) => a[0].localeCompare(b[0]))) if (k.startsWith('raw/') && rawFileOf(k.slice(4)) === file) out[k.slice(4)] = d;
      return JSON.stringify(out);
    }
    async flush() {
      if (this.flushing) { await this.flushing; if (this.dirty.size) return this.flush(); return; }
      const waiters = this.waiters || []; this.waiters = [];
      const batch = this.dirty; this.dirty = new Map();
      this.inflight = [...batch.values()].flat();
      this.flushing = (async () => {
        for (const [file, ops] of batch) {
          for (let attempt = 0; attempt < 4; attempt++) {
            const isEmptyRaw = file !== 'state.json' && this.serialize(file) === '{}';
            try {
              const sha = this.files.get(file);
              if (isEmptyRaw) {
                if (sha) await this.api(`/contents/${file}`, { method: 'DELETE', body: JSON.stringify({ message: `刪除 ${file}`, sha, branch: this.branch }) });
                this.files.delete(file); try { localStorage.removeItem('fin.c.' + file); } catch (e) {}
              } else {
                const text = this.serialize(file);
                const body = { message: `${file === 'state.json' ? '更新設定與編輯' : '匯入 ' + file}`, content: b64encode(text), branch: this.branch };
                if (sha) body.sha = sha;
                const r = await this.api(`/contents/${file}`, { method: 'PUT', body: JSON.stringify(body) });
                this.files.set(file, r.content.sha); cachePut(file, { sha: r.content.sha, text });
              }
              break;
            } catch (e) {
              if (e.code !== 'conflict' || attempt === 3) {
                // keep unsaved edits queued so the next write (or retry()) sends them again
                for (const [f, o] of batch) { if (!this.dirty.has(f)) this.dirty.set(f, []); this.dirty.get(f).unshift(...o); }
                this.inflight = []; this.persistPending();
                if (e.code) this.setStatus('error', e.message); else this.setStatus('offline', '沒有網路，已先存在這台裝置，連上網路後自動同步');
                waiters.forEach(w => w.reject(e)); this.flushing = null; return;
              }
              // someone else (the other device) changed this file: reload it and replay our edits on top
              const r = await this.readFile(file, null);
              if (r) { this.files.set(file, r.sha); this.ingest(file, r.text); } else this.files.delete(file);
              for (const o of ops) { if (o.op === 'set') this.docs.set(o.path, o.data); else this.docs.delete(o.path); }
            }
          }
        }
        this.inflight = []; this.persistPending();
        this.setStatus(this.dirty.size ? 'saving' : 'synced');
        waiters.forEach(w => w.resolve());
        this.flushing = null;
        this.emit();
      })();
      return this.flushing;
    }
    retry() { if (this.dirty.size) return this.flush(); return Promise.resolve(); }
    exportAll() { return Object.fromEntries(this.docs); }
  }
  root.GitStore = GitStore;
})(typeof window !== 'undefined' ? window : globalThis);
