import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {scenarios} from '../test/scenarios.js';
const baseURL=process.env.SERVER_URL;
if(!baseURL || new URL(baseURL).protocol!=='https:') throw new Error('Set SERVER_URL to the verified HTTPS deployment URL');
const cli=process.env.VERCEL_CLI_PATH || 'vercel';
const scope=process.env.VERCEL_SCOPE || 'iti1';
const tokens=JSON.parse(process.env.AUTH_TOKENS_JSON || '{}');
await mkdir('.tools/live-headers',{recursive:true,mode:0o700});
const results=[];
let createdForKhalid;
for(const {id,user_id,message,expected} of scenarios) {
  if(!tokens[user_id]) throw new Error('Missing employee token for live demo');
  const headerFile=`.tools/live-headers/${user_id}.txt`;
  await writeFile(headerFile,`Content-Type: application/json\nAuthorization: Bearer ${tokens[user_id]}\n`,{mode:0o600});
  const output=execFileSync(cli,['curl',`${baseURL}/chat`,'--scope',scope,'--','--silent','--show-error','--include','-X','POST','-H',`@${headerFile}`,'-d',JSON.stringify({user_id,message})],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
  const statuses=[...output.matchAll(/HTTP\/\S+\s+(\d+)/g)];
  const status=Number(statuses.at(-1)?.[1]);
  const separator=output.lastIndexOf('\r\n\r\n');
  if(separator<0) throw new Error('HTTP response header missing');
  const result=JSON.parse(output.slice(separator+4));
  let passed=result.action===expected && status===(expected==='reject'?403:200);
  if(id==='T01') {createdForKhalid=result.task_id;passed &&= result.task?.assignee_id===4;}
  if(id==='T03') passed &&= result.rescheduled===true;
  if(id==='T05') passed &&= result.tasks?.every(t=>t.assignee_id===4) && result.tasks.some(t=>t.id===createdForKhalid);
  if(id==='T06') passed &&= result.policy_ids?.includes(2);
  if(id==='T07') passed &&= result.reply?.includes('غير متوفرة');
  const record={id,passed,status,action:result.action};results.push(record);console.log(JSON.stringify(record));
}
await writeFile('.tools/cloud-demo-results.json',JSON.stringify(results,null,2)+'\n',{mode:0o600});
process.exitCode=results.some(r=>!r.passed)?1:0;
