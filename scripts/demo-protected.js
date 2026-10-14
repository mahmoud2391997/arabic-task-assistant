import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {scenarios,scenarioExpected} from '../test/scenarios.js';
import {demoRequest,scenarioPassed} from './demo-client.js';
const baseURL=process.env.SERVER_URL;
if(!baseURL || new URL(baseURL).protocol!=='https:') throw new Error('Set SERVER_URL to the verified HTTPS deployment URL');
const cli=process.env.VERCEL_CLI_PATH || 'vercel';
const scope=process.env.VERCEL_SCOPE || 'iti1';
const tokens=JSON.parse(process.env.AUTH_TOKENS_JSON || '{}');
await mkdir('.tools/live-headers',{recursive:true,mode:0o700});
const results=[];
let createdForKhalid;
for(const scenario of scenarios) {
  const {id,user_id,message} = scenario;
  const expected = scenarioExpected(scenario);
  if(!tokens[user_id]) throw new Error('Missing employee token for live demo');
  const headerFile=`.tools/live-headers/${user_id}.txt`;
  await writeFile(headerFile,`Content-Type: application/json\nAuthorization: Bearer ${tokens[user_id]}\n`,{mode:0o600});
  const {response,result}=await demoRequest(`${baseURL}/chat`,{user_id,message},{},async(url,request)=>{
    const output=execFileSync(cli,['curl',url,'--scope',scope,'--','--silent','--show-error','--include','-X','POST','-H',`@${headerFile}`,'-d',request.body],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
    const statuses=[...output.matchAll(/HTTP\/\S+\s+(\d+)/g)];
    const status=Number(statuses.at(-1)?.[1]);
    const separator=output.lastIndexOf('\r\n\r\n');
    if(separator<0) throw new Error('HTTP response header missing');
    const body=JSON.parse(output.slice(separator+4));
    const retry=output.match(/retry-after:\s*(\d+)/i)?.[1];
    return {status,headers:{get:()=>retry},json:async()=>body};
  });
  const status=response.status;
  if(id==='T01') createdForKhalid=result.task_id;
  const passed=scenarioPassed(scenario,expected,status,result,createdForKhalid);
  const record={id,passed,status,action:result.action};results.push(record);console.log(JSON.stringify(record));
}
await writeFile('.tools/cloud-demo-results.json',JSON.stringify(results,null,2)+'\n',{mode:0o600});
process.exitCode=results.some(r=>!r.passed)?1:0;
