import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { createChat } from './chat.js';
import { policy } from './language.js';
import { validateIntent } from './ai.js';

const hash = code => createHash('sha256').update(code).digest('hex');
function roleIntroduction(user) {
  const common='تقدر تقدم طلباتك وتسأل عن سياسة الشركة بكلامك الطبيعي.';
  const role=user.role==='manager' ? 'تقدر تعرض مهامك وجميع مهام الشركة، وتراجع المصروفات الموجهة لك للاعتماد.'
    : user.role==='supervisor' ? 'تقدر تعرض مهامك ومهام قسمك، وتراجع الطلبات الموجهة لك للموافقة، وتتابع وصول التقارير الطبية لقسمك.'
    : 'تقدر تعرض مهامك وتحدث حالتها، وتتابع الطلبات اللي قدمتها.';
  return `اتعرفت على حساب ${user.name}. ${role} ${common} اطلب اللي تحتاجه بصياغتك المعتادة؛ لو معلومة ناقصة هسألك عنها. اختيار رقم الموظف هنا للتجربة.`;
}
const onboarding = 'أهلاً! أنا مساعد المهام. تقدر تسأل عن سياسة الشركة. تسجيل وعرض المهام يحتاج ربط حساب موظف برابط آمن من مسؤول النظام.';

export function createTelegram({pool,ai,token,secret,username,identityMode='secure_link',fetchImpl=fetch}) {
  if (!token || !secret || secret.length < 32 || !/^[A-Za-z0-9_]+bot$/i.test(username || '')) throw new Error('Set Telegram token, username and strong webhook secret');
  if (!['secure_link','demo_id'].includes(identityMode)) throw new Error('Invalid Telegram identity mode');
  const demo = identityMode === 'demo_id';
  async function welcome(client) {
    if (!demo) return onboarding;
    return 'أهلاً بك في مساعد المهام! ابعت رقم الموظف (Employee ID) عشان أتعرف على حسابك وأبدأ التعامل معاك. اختيار الرقم مفعّل حالياً للتجربة.';
  }
  async function api(method, body) {
    let response;
    try { response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
      signal:AbortSignal.timeout(15000),
    }); } catch { throw new Error('Telegram transport failed'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error('Telegram request failed');
    return data.result;
  }
  async function processUpdate(client, message) {
    const id = message.from.id;
    const text = (message.text || message.caption || '').trim();
    const start = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/);
    if (demo) {
      const choice=text.match(/^(?:\/employee(?:@[A-Za-z0-9_]+)?\s+)?([1-9][0-9]*)$/);
      if (choice) {
        const employeeId=Number(choice[1]);
        const store=new Store(client,true);const user=await store.user(employeeId);
        if (!user) return 'رقم الموظف غير موجود. ابعت رقم موظف صحيح.';
        await client.query(`INSERT INTO telegram_bindings (telegram_id,employee_id,identity_mode) VALUES ($1,$2,'demo_id') ON CONFLICT (telegram_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,identity_mode='demo_id'`,[id,employeeId]);
        await client.query('DELETE FROM telegram_conversations WHERE telegram_id=$1',[id]);
        await store.audit(employeeId,'telegram_demo_identity',{});
        return roleIntroduction(user);
      }
    }
    if (start?.[1]) {
      const code = start[1];
      if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return 'رابط الربط غير صالح أو انتهت صلاحيته.';
      const row = (await client.query(`DELETE FROM telegram_link_codes WHERE code_hash=$1 AND expires_at>$2 RETURNING employee_id`,[hash(code),new Date()])).rows[0];
      if (!row) return 'رابط الربط غير صالح أو انتهت صلاحيته.';
      const existing = (await client.query('SELECT * FROM telegram_bindings WHERE telegram_id=$1 OR employee_id=$2',[id,row.employee_id])).rows;
      if (existing.some(b => String(b.telegram_id)!==String(id) || b.employee_id!==row.employee_id)) return 'الحساب مرتبط بالفعل. تواصل مع المسؤول لتغيير الربط.';
      await client.query('INSERT INTO telegram_bindings (telegram_id,employee_id) VALUES ($1,$2) ON CONFLICT (telegram_id) DO NOTHING',[id,row.employee_id]);
      const store = new Store(client,true);
      await store.audit(row.employee_id,'telegram_link',{});
      const user = await store.user(row.employee_id);
      await client.query('DELETE FROM telegram_conversations WHERE telegram_id=$1',[id]);
      return roleIntroduction(user);
    }
    if (start) return welcome(client);
    if (/^\/help(?:@[A-Za-z0-9_]+)?$/.test(text) || text==='مساعدة') return 'اكتب رقم الموظف لاختياره. «طلباتي» لطلباتك، و«طلبات للاعتماد» للطلبات الموجهة لك. أمثلة: قدّم طلب إجازة اعتيادية بعد 5 أيام عمل؛ قدّم طلب مصروفات 650 ريال؛ اعتمد الطلب رقم 12؛ حدث حالة المهمة رقم 4 إلى مكتملة. لرفع تقرير طبي، أرفق الملف مع تعليق «تقرير الطلب 12».';
    if (text==='طلب جديد') return 'اكتب نوع الطلب وتفاصيله: إجازة اعتيادية وتاريخها، عمل عن بعد وتاريخه، مصروفات والمبلغ بالريال، أو إجازة مرضية وتاريخ العودة.';
    if (text==='تحديث حالة مهمة') return 'اكتب مثلاً «حدث حالة المهمة رقم 4 إلى مكتملة» أو «قيد التنفيذ». التحديث في يوم المهمة خلال الدوام فقط.';
    const binding = (await client.query('SELECT employee_id FROM telegram_bindings WHERE telegram_id=$1 AND identity_mode=$2',[id,identityMode])).rows[0];
    if (binding) {
      const document=message.document || (message.photo?.length ? {file_id:message.photo.at(-1).file_id,file_size:message.photo.at(-1).file_size,mime_type:'image/jpeg'} : undefined);
      const previous=(await client.query('SELECT messages FROM telegram_conversations WHERE telegram_id=$1 AND employee_id=$2',[id,binding.employee_id])).rows[0]?.messages || [];
      const history=Array.isArray(previous) ? previous.slice(-6) : [];
      const result = await createChat({store:new Store(client,true),ai})({user_id:binding.employee_id,message:text,document,history});
      const messages=[...history,{role:'user',content:text.slice(0,1200)},{role:'assistant',content:result.reply.slice(0,1200)}].slice(-6);
      await client.query('INSERT INTO telegram_conversations (telegram_id,employee_id,messages) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,messages=EXCLUDED.messages',[id,binding.employee_id,JSON.stringify(messages)]);
      return result.reply;
    }
    if (demo) return welcome(client);
    // Guests can ask public policy questions, without receiving employee identities or tasks.
    const intent = validateIntent(await ai({message:text,users:[],now:new Date()}));
    if (intent.action !== 'policy_question') return welcome(client);
    const ids = [...new Set(intent.policy_ids)];
    return intent.policy_supported && ids.length ? ids.map(id => policy[id-1]).join('\n') : 'هذه المعلومة غير متوفرة في نص سياسة الشركة.';
  }
  return {
    authorize(value) {
      if (typeof value !== 'string') return false;
      const a=Buffer.from(value), b=Buffer.from(secret);
      return a.length===b.length && timingSafeEqual(a,b);
    },
    async linkCode(employeeId) {
      if (!(await new Store(pool).user(employeeId))) throw new Error('FORBIDDEN');
      const code=randomBytes(24).toString('base64url');
      await pool.query(`INSERT INTO telegram_link_codes (code_hash,employee_id,expires_at) VALUES ($1,$2,$3)`,[hash(code),employeeId,new Date(Date.now()+600000)]);
      return {url:`https://t.me/${username}?start=${code}`,expires_in_seconds:600};
    },
    async receive(update) {
      const m=update?.message;
      if (!Number.isSafeInteger(update?.update_id) || update.update_id<0 || !m || m.chat?.type!=='private' || !Number.isSafeInteger(m.from?.id) || m.from.id<=0 || m.from.is_bot || m.chat.id!==m.from.id || typeof (m.text??m.caption)!=='string' || !(m.text??m.caption).trim() || (m.text??m.caption).length>4000) return;
      const client=await pool.connect(); let reply;
      try {
        await client.query('BEGIN');
        const inserted=(await client.query('INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT (update_id) DO NOTHING RETURNING update_id',[update.update_id])).rows.length;
        if (inserted) {
          reply=await processUpdate(client,m);
          await client.query('UPDATE telegram_updates SET reply=$1 WHERE update_id=$2',[reply,update.update_id]);
        } else reply=(await client.query('SELECT reply FROM telegram_updates WHERE update_id=$1',[update.update_id])).rows[0]?.reply;
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      // Persist task and reply together before delivery. Retried updates reuse the reply and cannot create another task.
      if (reply) {
        const chars=Array.from(reply);
        for(let i=0;i<chars.length;i+=3500) await api('sendMessage',{chat_id:m.chat.id,text:chars.slice(i,i+3500).join(''),reply_markup:{remove_keyboard:true}});
      }
    },
  };
}
