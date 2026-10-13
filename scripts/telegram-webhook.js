import {readFileSync} from 'node:fs';

const token=process.env.TELEGRAM_BOT_TOKEN;
const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
const base=process.env.SERVER_URL;
const username=process.env.TELEGRAM_BOT_USERNAME;
async function api(method,body={}) {
  try {
    const res=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data=await res.json();
    if(!res.ok||!data.ok) throw new Error();
    return data.result;
  } catch {throw new Error(`Telegram ${method} failed`);}
}
try {
  if(!token||!secret||!base||!username) throw new Error('Set Telegram configuration and SERVER_URL');
  const user=await api('getMe');
  if(user.username!==username) throw new Error('Bot username mismatch');
  const url=new URL('/telegram/webhook',base);
  if(url.protocol!=='https:') throw new Error('Webhook requires HTTPS');
  const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET || (process.env.TELEGRAM_BYPASS_FILE ? readFileSync(process.env.TELEGRAM_BYPASS_FILE,'utf8').trim() : '');
  if(url.hostname.endsWith('.vercel.app') && !bypass) throw new Error('Set private Vercel automation access for protected webhook');
  if(bypass) url.searchParams.set('x-vercel-protection-bypass',bypass);
  await api('setWebhook',{url:url.toString(),secret_token:secret,allowed_updates:['message','callback_query'],max_connections:1});
  await api('setMyDescription',{description:'مساعد مهام الموظفين بالعربي. ابدأ المحادثة وابعت رقم الموظف، ثم سجّل مهام أو اعرض مهامك أو اسأل عن سياسة الشركة. استخدام حساب الموظف يتطلب ربطاً آمناً.'});
  await api('setMyCommands',{commands:[{command:'start',description:'ابدأ المحادثة وحدد رقم الموظف'},{command:'employee',description:'تغيير الموظف: اكتب الرقم بعد الأمر'},{command:'help',description:'طريقة الاستخدام'}]});
  const info=await api('getWebhookInfo');
  if(info.url!==url.toString()) throw new Error('Webhook verification failed');
  // Never print the webhook URL: its query contains a project credential.
  console.log(JSON.stringify({bot:username,webhook_configured:true,pending_updates:info.pending_update_count}));
} catch(error) {console.error(error.message);process.exitCode=1;}
