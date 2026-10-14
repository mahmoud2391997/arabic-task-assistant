import { scenarios, scenarioExpected } from '../test/scenarios.js';
import {demoRequest,scenarioPassed} from './demo-client.js';
import {writeFile} from 'node:fs/promises';
const baseURL = process.env.SERVER_URL || 'http://localhost:3000';
const tokens = JSON.parse(process.env.AUTH_TOKENS_JSON || '{}');
let failed = false;
let createdForKhalid;
const records=[];
for (const scenario of scenarios) {
  const {id,user_id,message} = scenario;
  const expected = scenarioExpected(scenario);
  const {response,result}=await demoRequest(`${baseURL}/chat`,{user_id,message},tokens[user_id]?{Authorization:`Bearer ${tokens[user_id]}`} : {});
  if(id==='T01') createdForKhalid=result.task_id;
  const passed=scenarioPassed(scenario,expected,response.status,result,createdForKhalid);
  failed ||= !passed;
  const record={id,passed,http_status:response.status,result};records.push(record);
  console.log(JSON.stringify(record,null,2));
}
if(process.env.DEMO_REPORT_PATH) await writeFile(process.env.DEMO_REPORT_PATH,JSON.stringify(records,null,2)+'\n',{mode:0o600});
process.exitCode = failed ? 1 : 0;
