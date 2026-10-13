import {classifyResponse} from './responses.js';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {Store} from './store.js';
import {createChat} from './chat.js';
import {policy} from './language.js';
import {validateIntent} from './ai.js';
const hash=code=>createHash('sha256').update(code).digest('hex');
const welcome='أهلاً بك في مساعد المهام! 👋 أرسل رقم الموظف (User ID) للمتابعة. يلزم ربط آمن للحساب قبل استخدامه.';
const actions=[
 ['mine','مهامي','مهامي'],['create','إنشاء مهمة','أريد إنشاء مهمة'],
 ['requests','طلباتي','طلباتي'],['new','طلب جديد','أريد تقديم طلب'],
 ['sick','تسجيل العودة من المرضية','عدت اليوم من الإجازة المرضية'],
 ['update','تحديث حالة مهمة','أريد تحديث حالة مهمة'],['report','إرفاق تقرير طبي','أريد إرفاق تقرير طبي'],
 ['policy','سياسة الشركة','سياسة الشركة'],
 ['department','مهام القسم','مهام القسم',['supervisor']],
 ['company','كل المهام','كل المهام',['manager']],
 ['approvals','طلبات للاعتماد','طلبات للاعتماد',['supervisor','manager']],
 ['decision','اعتماد أو رفض طلب','أريد اتخاذ قرار بشأن طلب',['supervisor','manager']],
 ['reports','متابعة التقارير الطبية','متابعة التقارير',['supervisor']],
];
const requestActions=[['annual','إجازة اعتيادية','أريد تقديم طلب إجازة اعتيادية'],['remote','عمل عن بُعد','أريد تقديم طلب عمل عن بعد'],['expense','مصروفات','أريد تقديم طلب مصروفات']];
function requestKeyboard(revision) {return {inline_keyboard:requestActions.map(a=>[{text:a[1],callback_data:`${revision}:${a[0]}`}])};}
function keyboard(user,revision) {
 return {inline_keyboard:actions.filter(a=>!a[3]||a[3].includes(user.role)).map(a=>[{text:a[1],callback_data:`${revision}:${a[0]}`}])};
}
function notificationText(rows) {
 return rows.length?'إشعاراتك الجديدة:\n'+rows.map(n=>`${n.actor_role==='manager'?'المدير':'المشرف'} ${n.actor_name} أسند لك مهمة #${n.task_id}: ${n.description}`).join('\n')+'\n\n':'';
}
function introduction(user) {
 return `تعرفت على حسابك، أهلاً ${user.name}! 👋\n${actions.filter(a=>!a[3]||a[3].includes(user.role)).map(a=>a[1]).join('، ')}.\nتحدث بالعربية الفصحى أو باللهجة السعودية أو بصياغتك المعتادة. إذا احتجت تفاصيل سأطلبها منك.`;
}
export function identityRequest(text,awaiting) {
 const value=text.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).trim();
 const explicit=value.match(/^(?:\/employee(?:@[A-Za-z0-9_]+)?\s+|(?:my\s+user\s+id\s+is|change\s+my\s+user\s+id\s+to|use\s+user\s+id)\s+|(?:رقمي التعريفي|رقم الموظف|رقمي|غير\s+(?:الـ\s*)?(?:id|آي دي|رقم الموظف)\s*(?:إلى|الى|لـ)?|استخدم\s+(?:id|رقم الموظف))\s*)([0-9]+)[.!؟]?$/i);
 const bare=awaiting&&value.match(/^([0-9]+)$/);
 return explicit||bare ? Number((explicit||bare)[1]) : undefined;
}
export function createTelegram({pool,ai,token,secret,username,identityMode='secure_link',fetchImpl=fetch,clock=()=>new Date()}) {
 if(!token||!secret||secret.length<32||!/^[A-Za-z0-9_]+bot$/i.test(username||'')) throw new Error('Set Telegram token, username and strong webhook secret');
 if(!['secure_link','demo_id'].includes(identityMode)) throw new Error('Invalid Telegram identity mode');
 const demo=identityMode==='demo_id';
 const onboarding=demo?'أهلاً بك في مساعد المهام! 👋 أرسل رقم الموظف (User ID) للمتابعة. اختيار الحساب بالرقم مفعّل للتجربة.':welcome;
 async function api(method,body) {
  let response;try {response=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new Error('Telegram transport failed');}
  const data=await response.json().catch(()=>({}));if(!response.ok||data.ok!==true) throw new Error('Telegram request failed');return data.result;
 }
 async function session(client,id) {
  await client.query('INSERT INTO telegram_sessions (telegram_id,revision,expires_at) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO NOTHING',[id,randomBytes(8).toString('hex'),new Date(clock().getTime()+86400000)]);
  return (await client.query('SELECT * FROM telegram_sessions WHERE telegram_id=$1 FOR UPDATE',[id])).rows[0];
 }
 async function activate(client,id,userId,s) {
  const user=await new Store(client,true).user(userId);
  if(!user) return {reply:'رقم الموظف غير موجود. أرسل رقماً صحيحاً.',action_type:'rejection'};
  const allowed=(await client.query('SELECT employee_id FROM telegram_access WHERE telegram_id=$1 AND employee_id=$2',[id,userId])).rows.length;
  if(!demo&&!allowed) return {reply:'الحساب غير مصرح لك باستخدامه. اطلب رابط الربط الآمن من مسؤول النظام ثم أرسل رقم الموظف. الحساب الحالي لم يتغير.',action_type:'rejection'};
  const revision=randomBytes(8).toString('hex');
  await client.query('UPDATE telegram_sessions SET active_user_id=$1,awaiting_id=false,current_action=NULL,revision=$2,expires_at=$3 WHERE telegram_id=$4',[userId,revision,new Date(clock().getTime()+86400000),id]);
  await client.query("INSERT INTO telegram_bindings (telegram_id,employee_id,identity_mode) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,identity_mode=EXCLUDED.identity_mode",[id,userId,demo?'demo_id':'secure_link']);
  await client.query('DELETE FROM telegram_conversations WHERE telegram_id=$1',[id]);
  await new Store(client,true).audit(userId,'telegram_identity',{});
  const notices=await new Store(client,true).consumeNotifications(userId);
  return {reply:notificationText(notices)+introduction(user),action_type:'execution',menu:keyboard(user,revision)};
 }
 async function process(client,m,callback) {
  const id=m.from.id;let selectedAction,selectedRequestType;let text=(m.text||m.caption||'').trim();const s=await session(client,id);
  const start=text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/);
  if(start?.[1]) {
   const code=start[1];if(!/^[A-Za-z0-9_-]{32}$/.test(code)) return {reply:'رابط الربط غير صالح أو انتهت صلاحيته.'};
   const row=(await client.query('DELETE FROM telegram_link_codes WHERE code_hash=$1 AND expires_at>$2 RETURNING employee_id',[hash(code),clock()])).rows[0];
   if(!row) return {reply:'رابط الربط غير صالح أو انتهت صلاحيته.'};
   await client.query('INSERT INTO telegram_access (telegram_id,employee_id) VALUES ($1,$2) ON CONFLICT (telegram_id,employee_id) DO NOTHING',[id,row.employee_id]);
   return activate(client,id,row.employee_id,s);
  }
  if(start) {
   await client.query("UPDATE telegram_sessions SET awaiting_id=true,current_action='identify',revision=$1,expires_at=$2 WHERE telegram_id=$3",[randomBytes(8).toString('hex'),new Date(clock().getTime()+86400000),id]);
   await client.query('DELETE FROM telegram_conversations WHERE telegram_id=$1',[id]);return {reply:onboarding};
  }
  const choice=identityRequest(text,s.awaiting_id);if(choice!==undefined) return activate(client,id,choice,s);
  if(new Date(s.expires_at)<=clock()) {
   await client.query('UPDATE telegram_sessions SET active_user_id=NULL,awaiting_id=true,current_action=NULL,revision=$1 WHERE telegram_id=$2',[randomBytes(8).toString('hex'),id]);
   await client.query('DELETE FROM telegram_conversations WHERE telegram_id=$1',[id]);return {reply:'انتهت جلسة المحادثة. '+onboarding};
  }
  if(callback) {
   const [revision,key]=callback.data?.split(':')||[];
   const actor=s.active_user_id ? await new Store(client,true).user(s.active_user_id) : null;
   const selected=[...actions,...requestActions].find(a=>a[0]===key&&(!a[3]||a[3].includes(actor?.role)));
   if(s.awaiting_id||!actor||revision!==s.revision||!selected) return {reply:'هذا الزر قديم أو غير متاح لحسابك. أرسل رقم الموظف أو ابدأ المحادثة مجدداً.'};
   text=selected[2];selectedAction={create:'create_task',new:'create_request',annual:'create_request',remote:'create_request',expense:'create_request',sick:'create_request',update:'update_task',report:'submit_report',decision:'decide_request'}[key];selectedRequestType={sick:'sick_leave',annual:'annual_leave',remote:'remote_work',expense:'expense'}[key];
  }
  if(!s.active_user_id||s.awaiting_id) {
   // Public policy remains available without disclosing employees or tasks.
   if(!callback&&!s.active_user_id&&!s.current_action&&text&&!/^\d+$/.test(text)) {
    const intent=validateIntent(await ai({message:text,users:[],now:clock()}));
    if(intent.action==='policy_question') {const ids=[...new Set(intent.policy_ids)];return classifyResponse({action:'policy_answer',policy_ids:intent.policy_supported?ids:[],reply:intent.policy_supported&&ids.length?ids.map(i=>policy[i-1]).join('\n'):'هذه المعلومة غير متوفرة في نص سياسة الشركة.'});}
   }
   return {reply:onboarding};
  }
  const allowed=(await client.query('SELECT employee_id FROM telegram_access WHERE telegram_id=$1 AND employee_id=$2',[id,s.active_user_id])).rows.length;
  if(!demo&&!allowed) return {reply:'صلاحية الحساب غير متاحة. '+onboarding,action_type:'rejection'};
  const previous=(await client.query('SELECT messages FROM telegram_conversations WHERE telegram_id=$1 AND employee_id=$2',[id,s.active_user_id])).rows[0]?.messages||[];
  const history=Array.isArray(previous)?previous.slice(-6):[];
  const incoming=m.document||(m.photo?.length?{file_id:m.photo.at(-1).file_id,file_size:m.photo.at(-1).file_size,mime_type:'image/jpeg'}:undefined);
  const attachment=incoming?{file_id:incoming.file_id,file_size:incoming.file_size,mime_type:incoming.mime_type}:undefined;
  const document=attachment;
  if(!text&&attachment) text=s.current_action==='submit_report'?'أرفق التقرير الطبي':'أرسلت مرفقاً';
  const result=await createChat({store:new Store(client,true),ai,clock})({user_id:s.active_user_id,message:text,document,history,selectedAction,selectedRequestType,requireLeaveRange:true});
  const notices=await new Store(client,true).consumeNotifications(s.active_user_id);
  result.message=notificationText(notices)+result.message;result.reply=result.message;
  const messages=[...history,{role:'user',content:text.slice(0,1200)},{role:'assistant',content:result.message.slice(0,1200)}].slice(-6);
  await client.query('INSERT INTO telegram_conversations (telegram_id,employee_id,messages) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,messages=EXCLUDED.messages',[id,s.active_user_id,JSON.stringify(messages)]);
  await client.query('UPDATE telegram_sessions SET current_action=$1,expires_at=$2 WHERE telegram_id=$3',[result.action_type==='inquiry'?result.action:null,new Date(clock().getTime()+86400000),id]);
  const actor=await new Store(client,true).user(s.active_user_id);return {...result,menu:result.action==='create_request'&&result.action_type==='inquiry'&&!result.request_type?requestKeyboard(s.revision):keyboard(actor,s.revision)};
 }
 return {
  authorize(value) {if(typeof value!=='string') return false;const a=Buffer.from(value),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);},
  async linkCode(employeeId) {if(!(await new Store(pool).user(employeeId))) throw new Error('FORBIDDEN');const code=randomBytes(24).toString('base64url');await pool.query('INSERT INTO telegram_link_codes (code_hash,employee_id,expires_at) VALUES ($1,$2,$3)',[hash(code),employeeId,new Date(clock().getTime()+600000)]);return {url:`https://t.me/${username}?start=${code}`,expires_in_seconds:600};},
  async receive(update) {
   const callback=update?.callback_query;
   const m=callback?{...callback.message,from:callback.from,text:''}:update?.message;
   if(!Number.isSafeInteger(update?.update_id)||update.update_id<0||!m||m.chat?.type!=='private'||!Number.isSafeInteger(m.from?.id)||m.from.id<=0||m.from.is_bot||m.chat.id!==m.from.id) return;
   if(callback ? typeof callback.id!=='string'||typeof callback.data!=='string'||callback.data.length>64 : (!m.document&&!m.photo?.length&&(typeof(m.text??m.caption)!=='string'||!(m.text??m.caption).trim()))||(m.text??m.caption??'').length>4000) return;
   let client,result;
   try {
    client=await pool.connect();await client.query('BEGIN');
    const inserted=(await client.query('INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT (update_id) DO NOTHING RETURNING update_id',[update.update_id])).rows.length;
    if(inserted) {result=classifyResponse(await process(client,m,callback));await client.query('UPDATE telegram_updates SET reply=$1,response_type=$2,menu=$3 WHERE update_id=$4',[result.message,result.response_type,JSON.stringify(result.menu||null),update.update_id]);}
    else {const row=(await client.query('SELECT reply,menu FROM telegram_updates WHERE update_id=$1',[update.update_id])).rows[0];result={message:row?.reply,menu:row?.menu};}
    await client.query('COMMIT');
   }catch(error) {if(client) await client.query('ROLLBACK').catch(()=>{});result={message:'تعذر تنفيذ الطلب الآن. حاول مرة أخرى.'};}
   finally {client?.release();}
   if(callback) await api('answerCallbackQuery',{callback_query_id:callback.id}).catch(()=>{});
   if(result?.message) {const chars=Array.from(result.message);for(let i=0;i<chars.length;i+=3500) await api('sendMessage',{chat_id:m.chat.id,text:chars.slice(i,i+3500).join(''),...(i+3500>=chars.length&&result.menu?{reply_markup:result.menu}:{})});}
  },
 };
}
