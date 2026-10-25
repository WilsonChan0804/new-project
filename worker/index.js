// Twofold sync relay. It only ever sees encrypted data: the key lives in your devices and the invite link,
// never on this server. Each "space" (one couple and all their devices) is one Durable Object with its own SQLite.
import { DurableObject } from 'cloudflare:workers';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const isHex = (s, n) => typeof s === 'string' && s.length === n && /^[0-9a-f]+$/.test(s);
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/api/ping') return json({ ok: true });

    // POST /api/space  { space, token }  — create a new private space.
    if (url.pathname === '/api/space' && request.method === 'POST') {
      const { space, token } = await request.json().catch(() => ({}));
      if (!isHex(space, 32) || !isHex(token, 64)) return json({ error: 'bad request' }, 400);
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
      const ok = await reg.claim(space, Number(env.MAX_SPACES || 2));
      if (!ok) return json({ error: 'This server already has its maximum number of spaces (MAX_SPACES in wrangler.toml).' }, 403);
      const stub = env.SPACE.get(env.SPACE.idFromName(space));
      return json(await stub.init(await sha256Hex(token)));
    }

    // /api/space/<id>/<action>  — everything else needs the space token.
    const m = url.pathname.match(/^\/api\/space\/([0-9a-f]{32})\/(changes|blob|blobs-missing|ws|usage)(?:\/([0-9a-f]{64}))?$/);
    if (!m) return json({ error: 'not found' }, 404);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '') || url.searchParams.get('t') || '';
    if (!isHex(token, 64)) return json({ error: 'unauthorised' }, 401);
    const stub = env.SPACE.get(env.SPACE.idFromName(m[1]));
    const req = new Request(request, { headers: new Headers({ ...Object.fromEntries(request.headers), 'X-Token-Hash': await sha256Hex(token), 'X-Action': m[2], 'X-Blob': m[3] || '' }) });
    const res = await stub.fetch(req);
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};

// Keeps the list of spaces so a public server can't be filled by strangers.
export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, created INTEGER)');
  }
  claim(id, max) {
    const sql = this.ctx.storage.sql;
    if (sql.exec('SELECT 1 FROM spaces WHERE id = ?', id).toArray().length) return true;
    if (sql.exec('SELECT COUNT(*) AS n FROM spaces').one().n >= max) return false;
    sql.exec('INSERT INTO spaces (id, created) VALUES (?, ?)', id, Date.now());
    return true;
  }
}

const MAX_RECORD = 1_900_000; // SQLite row limit is 2 MB; big photos/videos travel as blob parts instead
const PAGE = 300;

export class Space extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS changes (kind TEXT, id TEXT, seq INTEGER, ts INTEGER, deleted INTEGER, data TEXT, PRIMARY KEY (kind, id));
      CREATE INDEX IF NOT EXISTS changes_seq ON changes (seq);
      CREATE TABLE IF NOT EXISTS blobs (hash TEXT, part INTEGER, parts INTEGER, data BLOB, PRIMARY KEY (hash, part));
    `);
  }
  meta(k) { return this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v; }
  setMeta(k, v) { this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, String(v)); }

  init(tokenHash) {
    const existing = this.meta('token');
    if (existing && existing !== tokenHash) return { error: 'space exists' };
    if (!existing) { this.setMeta('token', tokenHash); this.setMeta('seq', 0); this.setMeta('created', Date.now()); }
    return { ok: true };
  }

  async fetch(request) {
    if (!this.meta('token') || this.meta('token') !== request.headers.get('X-Token-Hash')) return json({ error: 'unauthorised' }, 401);
    const action = request.headers.get('X-Action');
    const url = new URL(request.url);

    if (action === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (action === 'changes' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const rows = this.sql.exec('SELECT kind, id, seq, ts, deleted, data FROM changes WHERE seq > ? ORDER BY seq LIMIT ?', since, PAGE).toArray();
      return json({ changes: rows, seq: Number(this.meta('seq')), more: rows.length === PAGE });
    }

    if (action === 'changes' && request.method === 'POST') {
      const list = await request.json().catch(() => null);
      if (!Array.isArray(list) || list.length > 200) return json({ error: 'bad request' }, 400);
      let seq = Number(this.meta('seq'));
      for (const c of list) {
        if (typeof c.kind !== 'string' || typeof c.id !== 'string' || c.id.length > 200) continue;
        if (c.data && c.data.length > MAX_RECORD) return json({ error: 'record too large' }, 413);
        const cur = this.sql.exec('SELECT ts FROM changes WHERE kind = ? AND id = ?', c.kind, c.id).toArray()[0];
        if (cur && cur.ts > c.ts) continue; // a newer version is already here
        seq++;
        this.sql.exec('INSERT OR REPLACE INTO changes (kind, id, seq, ts, deleted, data) VALUES (?, ?, ?, ?, ?, ?)',
          c.kind, c.id, seq, Number(c.ts) || Date.now(), c.deleted ? 1 : 0, c.deleted ? null : c.data);
      }
      this.setMeta('seq', seq);
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify({ type: 'changed', seq })); } catch {} }
      return json({ seq });
    }

    if (action === 'blobs-missing' && request.method === 'POST') {
      const hashes = await request.json().catch(() => []);
      const missing = (Array.isArray(hashes) ? hashes : []).filter(hh => isHex(hh, 64) &&
        !this.sql.exec('SELECT 1 FROM blobs WHERE hash = ? AND part = 0', hh).toArray().length);
      return json({ missing });
    }

    const hash = request.headers.get('X-Blob');
    if (action === 'blob' && hash && request.method === 'PUT') {
      const part = Number(url.searchParams.get('part') || 0), parts = Number(url.searchParams.get('parts') || 1);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_RECORD || part < 0 || part >= parts) return json({ error: 'bad part' }, 400);
      this.sql.exec('INSERT OR REPLACE INTO blobs (hash, part, parts, data) VALUES (?, ?, ?, ?)', hash, part, parts, body);
      return json({ ok: true });
    }
    if (action === 'blob' && hash && request.method === 'GET') {
      const rows = this.sql.exec('SELECT part, parts, data FROM blobs WHERE hash = ? ORDER BY part', hash).toArray();
      if (!rows.length || rows.length !== rows[0].parts) return json({ error: 'not found' }, 404);
      return new Response(new Blob(rows.map(r => r.data)), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }

    if (action === 'usage') {
      const bytes = this.ctx.storage.sql.databaseSize;
      const records = this.sql.exec('SELECT COUNT(*) AS n FROM changes').one().n;
      return json({ bytes, records });
    }
    return json({ error: 'not found' }, 404);
  }

  webSocketMessage(ws, msg) { if (msg === 'ping') ws.send('pong'); }
  webSocketClose(ws, code) { try { ws.close(code); } catch {} }
}
