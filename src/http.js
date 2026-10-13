import http from 'node:http';
import {classifyResponse} from './responses.js';
import { timingSafeEqual } from 'node:crypto';
import { AIError } from './ai.js';

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(classifyResponse(body)));
}
function tokenIdentity(req, tokens) {
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  for (const [id, token] of Object.entries(tokens)) {
    const a = Buffer.from(supplied), b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a,b)) return Number(id);
  }
}
export function createHandler({ chat, authMode = 'demo', tokens = {}, health = async () => true, telegram }) {
  if (!['demo','token'].includes(authMode)) throw new Error('AUTH_MODE must be demo or token');
  if (authMode === 'token' && (!Object.keys(tokens).length || Object.entries(tokens).some(([id,t]) => !/^\d+$/.test(id) || typeof t !== 'string' || t.length < 32) || new Set(Object.values(tokens)).size !== Object.keys(tokens).length)) throw new Error('Provide unique tokens of at least 32 characters mapped to employee IDs');
  return async (req,res) => {
    req.setTimeout?.(25000);
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && pathname === '/health') {
        await health(); return send(res,200,{ status:'ok' });
      }
      if (!['/chat','/telegram/webhook','/telegram/link-code'].includes(pathname)) return send(res,404,{error:'Not found'});
      if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(res,405,{error:'Method not allowed'}); }
      const webhook = pathname === '/telegram/webhook';
      if (webhook && (!telegram || !telegram.authorize(req.headers['x-telegram-bot-api-secret-token']))) return send(res,401,{error:'Invalid webhook authentication'});
      const identity = authMode === 'token' ? tokenIdentity(req,tokens) : undefined;
      if (!webhook && authMode === 'token' && !identity) return send(res,401,{error:'Invalid authentication'});
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
      if (webhook) { await telegram.receive(body); return send(res,200,{ok:true}); }
      if (pathname === '/telegram/link-code') {
        if (!telegram) return send(res,503,{error:'Telegram is not configured'});
        if (!identity) return send(res,401,{error:'Employee authentication required'});
        return send(res,200,await telegram.linkCode(identity));
      }
      if (body && typeof body==='object' && !Array.isArray(body) && body.message === undefined) body.message=body.prompt;
      if (!body || !Number.isSafeInteger(body.user_id) || body.user_id < 1 || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) return send(res,400,{error:'Provide a positive integer user_id and message (1–4000 characters)'});
      if (identity && identity !== body.user_id) return send(res,403,{error:'user_id must match authenticated employee'});
      // Attachments are accepted only from the authenticated Telegram webhook.
      const result = await chat({user_id:body.user_id,message:body.message});
      send(res,result.action_type === 'rejection' || result.action === 'reject' ? 403 : 200,result);
    } catch (error) {
      if (error instanceof AIError) return send(res,502,{action:'error',action_type:'exception',response_type:'clarification', reply:'تعذر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.'});
      if (error.message === 'OUTSIDE_WORKING_HOURS') return send(res,400,{action:'reject',action_type:'rejection',response_type:'rejection',reply:'الموعد خارج ساعات الدوام. حدد وقتاً خلال الدوام.'});
      if (error.message === 'FORBIDDEN') return send(res,403,{action:'reject',response_type:'rejection',reply:'لا تملك صلاحية تنفيذ هذا الطلب.'});
      // Do not log tokens, raw messages, connection strings, or provider error bodies.
      console.error('Request failed:', error.name);
      send(res,500,{action:'error',action_type:'exception',response_type:'clarification',reply:'تعذر تنفيذ الطلب.'});
    }
  };
}

export function createServer(options) {
  return http.createServer(createHandler(options));
}
