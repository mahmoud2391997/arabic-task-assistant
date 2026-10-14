import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoRequest} from '../scripts/demo-client.js';
import {AIError,createAI} from '../src/ai.js';
import {createHandler} from '../src/http.js';
import {base} from './scenarios.js';

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
 let metrics;const options={baseURL:'https://api.groq.com/openai/v1',apiKey:'test',model:'qwen/qwen3.8-27b',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(base)}}],usage:{prompt_tokens:1400,completion_tokens:90}})})};
 await createAI({...options,onUsage:value=>{metrics=value;}})({message:'private',users:[],now:new Date()});assert.deepEqual(metrics,{input_tokens:1400,output_tokens:90});
 assert.equal((await createAI({...options,onUsage:()=>{throw new Error('metric failure');}})({message:'private',users:[],now:new Date()})).action,'clarify');
});
