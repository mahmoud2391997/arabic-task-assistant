import { scenarios, scenarioExpected } from '../test/scenarios.js';
const baseURL = process.env.SERVER_URL || 'http://localhost:3000';
const tokens = JSON.parse(process.env.AUTH_TOKENS_JSON || '{}');
let failed = false;
for (const scenario of scenarios) {
  const {id,user_id,message} = scenario;
  const expected = scenarioExpected(scenario);
  const response = await fetch(`${baseURL}/chat`,{
    method:'POST',headers:{'Content-Type':'application/json',
      ...(tokens[user_id] ? {Authorization:`Bearer ${tokens[user_id]}`} : {})},
    body:JSON.stringify({user_id,message}),
  });
  const result = await response.json();
  let passed = result.action === expected;
  if (id === 'T03') passed &&= result.rescheduled === true;
  if (id === 'T05') passed &&= result.tasks?.some(t => t.assignee_id === 4 && t.description.includes('عرض السعر'));
  if (id === 'T06') passed &&= result.policy_ids?.includes(2);
  if (id === 'T07') passed &&= result.reply?.includes('غير متوفرة');
  failed ||= !passed;
  console.log(JSON.stringify({id,passed,http_status:response.status,result},null,2));
}
process.exitCode = failed ? 1 : 0;
