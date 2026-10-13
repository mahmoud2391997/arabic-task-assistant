import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AIError } from './ai.js';

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(body));
}
function tokenIdentity(req, tokens) {
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  for (const [id, token] of Object.entries(tokens)) {
    const a = Buffer.from(supplied), b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a,b)) return Number(id);
  }
}
export function createHandler({ chat, authMode = 'demo', tokens = {}, health = async () => true }) {
  if (!['demo','token'].includes(authMode)) throw new Error('AUTH_MODE must be demo or token');
  if (authMode === 'token' && (!Object.keys(tokens).length || Object.entries(tokens).some(([id,t]) => !/^\d+$/.test(id) || typeof t !== 'string' || t.length < 32) || new Set(Object.values(tokens)).size !== Object.keys(tokens).length)) throw new Error('Provide unique tokens of at least 32 characters mapped to employee IDs');
  return async (req,res) => {
    req.setTimeout?.(25000);
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && pathname === '/health') {
        await health(); return send(res,200,{ status:'ok' });
      }
      if (pathname !== '/chat') return send(res,404,{error:'Not found'});
      if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(res,405,{error:'Method not allowed'}); }
      const identity = authMode === 'token' ? tokenIdentity(req,tokens) : undefined;
      if (authMode === 'token' && !identity) return send(res,401,{error:'Invalid authentication'});
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return send(res,415,{error:'Use application/json'});
      let body;
      try {
        // Vercel can pre-parse the body. Native Node requests expose a stream.
        if (req.body !== undefined) {
          const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          if (Buffer.byteLength(raw) > 16384) return send(res,413,{error:'Request too large'});
          body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else {
          const chunks = []; let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 16384) { send(res,413,{error:'Request too large'}); req.resume(); return; }
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
      } catch { return send(res,400,{error:'Invalid JSON'}); }
      if (!body || !Number.isSafeInteger(body.user_id) || body.user_id < 1 || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) return send(res,400,{error:'Provide a positive integer user_id and message (1–4000 characters)'});
      if (identity && identity !== body.user_id) return send(res,403,{error:'user_id must match authenticated employee'});
      const result = await chat(body);
      send(res,result.action === 'reject' ? 403 : 200,result);
    } catch (error) {
      if (error instanceof AIError) return send(res,502,{action:'error', reply:'تعذر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.'});
      if (error.message === 'FORBIDDEN') return send(res,403,{action:'reject',reply:'لا تملك صلاحية تنفيذ هذا الطلب.'});
      // Do not log tokens, raw messages, connection strings, or provider error bodies.
      console.error('Request failed:', error.name);
      send(res,500,{action:'error',reply:'تعذر تنفيذ الطلب.'});
    }
  };
}

export function createServer(options) {
  return http.createServer(createHandler(options));
}
