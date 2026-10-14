import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoRequest,scenarioPassed} from '../scripts/demo-client.js';
import {AIError,createAI} from '../src/ai.js';
import {createHandler} from '../src/http.js';
import {base,scenarios} from './scenarios.js';

test('T09 live validator requires the correct shifted date, hour and assignee, not merely create_task',()=>{
 const scenario=scenarios.find(s=>s.id==='T09'),now=new Date('2026-10-14T09:00:00Z');
 const result={action:'create_task',action_type:'postpone',rescheduled:true,task:{assignee_id:6,due_at:'2026-10-17T10:00:00.000Z'}};
 assert.equal(scenarioPassed(scenario,'create_task',200,result,undefined,now),true);
 assert.equal(scenarioPassed(scenario,'create_task',200,{...result,task:{...result.task,due_at:'2026-10-17T09:00:00.000Z'}},undefined,now),false);
 assert.equal(scenarioPassed(scenario,'create_task',200,{...result,task:{...result.task,assignee_id:4}},undefined,now),false);
 assert.equal(scenarioPassed(scenario,'create_task',403,{action:'create_task',action_type:'rejection'},undefined,now),false);
});

test('demo retries provider rate limits before execution, but never successful mutations or other failures',async()=>{
  const calls=[],waits=[];let n=0;
  const fetchImpl=async()=>{calls.push(++n);return {status:n===1?429:200,headers:new Headers({'retry-after':'2'}),json:async()=>n===1?{action_type:'exception'}:{action:'create_task',task_id:7}};};
  assert.equal((await demoRequest('http://localhost/chat',{}, {},fetchImpl,async ms=>waits.push(ms))).result.task_id,7);
  assert.equal(calls.length,2);assert.deepEqual(waits,[2000]);
  let other=0;await demoRequest('http://localhost/chat',{}, {},async()=>{other++;return {status:500,json:async()=>({action_type:'exception'})};},async()=>assert.fail('unsafe retry'));
  assert.equal(other,1);
});

test('rate limits expose a bounded retry header and do not run business mutations',async()=>{
 const handler=createHandler({chat:async()=>{throw new AIError('rate limited',429,12);}});let status,body;const headers={};
 await handler({method:'POST',url:'/chat',headers:{'content-type':'application/json'},body:{user_id:3,prompt:'test'}},{writeHead(s){status=s;},setHeader(k,v){headers[k]=v;},end(v){body=JSON.parse(v);}});
 assert.equal(status,429);assert.equal(headers['Retry-After'],'12');assert.equal(body.action_type,'exception');assert.match(body.message,/لم يُنفّذ/);
});

test('usage metrics contain numeric token counts only and never break valid intent extraction',async()=>{
 let metrics;const options={baseURL:'https://generativelanguage.googleapis.com/v1beta/openai',apiKey:'test',model:'gemini-3.1-flash-lite',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(base)}}],usage:{prompt_tokens:1400,completion_tokens:90}})})};
 await createAI({...options,onUsage:value=>{metrics=value;}})({message:'private',users:[],now:new Date()});assert.deepEqual(metrics,{input_tokens:1400,output_tokens:90});
 assert.equal((await createAI({...options,onUsage:()=>{throw new Error('metric failure');}})({message:'private',users:[],now:new Date()})).action,'clarify');
});
