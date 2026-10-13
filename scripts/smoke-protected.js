import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const base=new URL(process.env.SERVER_URL||'');
if(base.protocol!=='https:'||!base.hostname.endsWith('.vercel.app')||base.username||base.password||base.search) throw new Error('Expected verified Vercel deployment origin');
const cli=process.env.VERCEL_CLI_PATH||'vercel';
const tokens=JSON.parse(process.env.AUTH_TOKENS_JSON||'{}');
const [id,token]=Object.entries(tokens)[0]||[];
if(!id||!token) throw new Error('Employee authentication is required');
const dir=await mkdtemp(join(tmpdir(),'assistant-smoke-'));
try {
 const headers=join(dir,'headers');await writeFile(headers,`Content-Type: application/json\nAuthorization: Bearer ${token}\n`,{mode:0o600});
 function request(path,body) {
  const args=['curl',`${base.origin}${path}`,'--scope','iti1','--','--silent','--show-error','--max-time','45'];
  if(body) args.push('-X','POST','-H',`@${headers}`,'-d',JSON.stringify(body));
  const result=JSON.parse(execFileSync(cli,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}));
  if(typeof result.action!=='string'||typeof result.message!=='string'||!['execution','rejection','postpone','inquiry','exception'].includes(result.action_type)) throw new Error('Invalid API envelope');return result;
 }
 if(request('/health').status!=='ok') throw new Error('Database health check failed');
 const tasks=request('/chat',{user_id:Number(id),prompt:'مهامي'});if(tasks.action!=='list_tasks'||tasks.action_type!=='execution') throw new Error('Read-only API smoke failed');
 if(request('/chat',{prompt:'مهامي'}).action_type!=='rejection') throw new Error('Missing identity accepted');
 if(request('/telegram/webhook',{update_id:0}).action_type!=='rejection') throw new Error('Unauthenticated webhook accepted');
 if(process.env.TELEGRAM_BOT_TOKEN) {
  const res=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await res.json();if(!res.ok||!data.ok||!data.result.allowed_updates?.includes('callback_query')) throw new Error('Telegram callback webhook is not configured');
  if(new URL(data.result.url).hostname!=='arabic-task-assistant-iti1.vercel.app') throw new Error('Unexpected Telegram webhook target');
 }
 console.log('Protected health, API envelope, authorization and Telegram webhook checks passed. No test tasks were created.');
}finally{await rm(dir,{recursive:true,force:true});}
