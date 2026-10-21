// Fake Supabase front: auth answers a fixed user, /rest/v1 goes to a real PostgREST.
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = 'local-render-secret-0123456789abcdef0123456789';
const PGRST = 'http://127.0.0.1:54998';
const USER = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'me@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(role) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role, sub: USER.id, aud: 'authenticated', exp: 4102444800 });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const USER_JWT = jwt('authenticated');

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      if (u.pathname.startsWith('/auth/v1/')) {
        res.setHeader('content-type', 'application/json');
        if (u.pathname === '/auth/v1/user') return res.end(JSON.stringify(USER));
        return res.end(
          JSON.stringify({ access_token: USER_JWT, token_type: 'bearer', expires_in: 99999, refresh_token: 'r', user: USER }),
        );
      }
      if (u.pathname.startsWith('/storage/v1/')) {
        res.setHeader('content-type', 'application/json');
        if (u.pathname.includes('/object/sign/')) {
          const paths = (() => { try { return JSON.parse(body.toString()).paths ?? null; } catch { return null; } })();
          if (paths) return res.end(JSON.stringify(paths.map((p) => ({ path: p, signedURL: null, error: 'not found' }))));
          return res.end(JSON.stringify({ signedURL: null }));
        }
        return res.end('[]');
      }
      if (!u.pathname.startsWith('/rest/v1')) {
        res.statusCode = 404;
        return res.end('{}');
      }
      const target = PGRST + u.pathname.slice('/rest/v1'.length) + u.search;
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (['host', 'connection', 'content-length', 'apikey', 'authorization', 'accept-encoding'].includes(k)) continue;
        headers[k] = v;
      }
      headers.authorization = `Bearer ${USER_JWT}`;
      try {
        const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
        res.statusCode = r.status;
        r.headers.forEach((v, k) => {
          if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(k)) res.setHeader(k, v);
        });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.status >= 400) console.error('PGRST', r.status, req.method, u.pathname + u.search, buf.toString().slice(0, 300));
        res.end(buf);
      } catch (e) {
        res.statusCode = 502;
        res.end(JSON.stringify({ message: String(e) }));
      }
    });
  })
  .listen(54999, () => console.log('gateway on 54999'));
