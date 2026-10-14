import {setTimeout as wait} from 'node:timers/promises';

// Only rate-limit errors produced before intent extraction/mutation are retried.
export async function demoRequest(url,body,headers={},fetchImpl=fetch,waitImpl=wait) {
  for(let attempt=0;attempt<4;attempt++) {
    const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    const result=await response.json();
    if(response.status!==429||result.action_type!=='exception'||attempt===3) return {response,result};
    const requested=Number(response.headers.get('retry-after'));
    const seconds=Number.isFinite(requested)&&requested>0?Math.ceil(requested):30;
    if(seconds>120) return {response,result};
    console.log(JSON.stringify({retrying_rate_limit:true,wait_seconds:seconds}));
    await waitImpl(seconds*1000);
  }
}

export function scenarioPassed(scenario,expected,status,result,createdForKhalid) {
  let passed=status===(expected==='reject'?403:200)&&
    (expected==='reject'?result.action_type==='rejection':expected==='clarify'?result.action_type==='inquiry':result.action===expected);
  if(scenario.id==='T01') passed &&= result.task?.assignee_id===4;
  if(scenario.id==='T03') passed &&= result.rescheduled===true;
  if(scenario.id==='T05') passed &&= result.tasks?.every(t=>t.assignee_id===4)&&result.tasks.some(t=>t.id===createdForKhalid);
  if(scenario.id==='T06') passed &&= result.policy_ids?.includes(2);
  if(scenario.id==='T07') passed &&= result.message?.includes('غير متوفرة');
  return Boolean(passed);
}
