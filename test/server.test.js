import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import pg from 'pg';
import { initialize, Store } from '../src/store.js';
import { createChat } from '../src/chat.js';
import { createServer } from '../src/http.js';
import { createAI, AIError } from '../src/ai.js';
import { schedule, riyadhToday, policy, workingHoursError, workTime, hasTaskDescription } from '../src/language.js';
import { scenarios, base } from './scenarios.js';

async function setup() {
  const Pool = process.env.TEST_DATABASE_URL ? pg.Pool : newDb().adapters.createPg().Pool;
  const pool = new Pool(process.env.TEST_DATABASE_URL ? { connectionString:process.env.TEST_DATABASE_URL } : {});
  if (process.env.TEST_DATABASE_URL) await pool.query('DROP TABLE IF EXISTS audit_log,tasks,employees CASCADE');
  await initialize(pool);
  return { pool, store:new Store(pool) };
}
const now = new Date('2026-10-14T09:00:00Z'); // Wednesday; T09 lands on Friday.

test('T01–T10 business scenarios, with mocked AI and SQL-backed store', async () => {
  const {pool,store} = await setup();
  try {
    const chat = createChat({store,clock:() => now, ai: async ({message}) => scenarios.find(s => s.message === message).intent });
    const results = [];
    for (const scenario of scenarios) {
      const result = await chat(scenario); results.push(result);
      assert.equal(result.action_type,['T02','T04','T08','T09'].includes(scenario.id)?'rejection':scenario.id==='T10'||scenario.id==='T07'?'inquiry':scenario.id==='T03'?'postpone':'execution',scenario.id);
      assert.equal(result.action,scenario.intent.action==='policy_question'?'policy_answer':scenario.intent.action,scenario.id);
    }
    assert.equal(results[0].task.assignee_id,4);
    assert.equal(new Date(results[0].task.due_at).toISOString(),'2026-10-15T07:00:00.000Z');
    assert.equal(results[2].rescheduled,true);
    assert.equal(new Date(results[2].task.due_at).toISOString(),'2026-10-17T06:00:00.000Z');
    assert.match(results[2].reply,/الجمعة.*السبت/);
    assert.equal(results[4].tasks.length,1);
    assert.equal(results[4].tasks[0].id,results[0].task_id);
    assert.equal(results[5].reply,policy[1]);
    assert.match(results[6].reply,/غير متوفرة/);
    assert.match(results[8].reply,/الجمعة.*السبت.*خارج ساعات/);
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,2);
    assert.equal((await pool.query('SELECT * FROM audit_log')).rows.length,10);
  } finally { await pool.end(); }
});

test('repository rejects unauthorized assignments and reads even when bypassing chat', async () => {
  const {pool,store} = await setup();
  try {
    await assert.rejects(store.create(3,4,'forged role','2026-10-15T10:00:00+03:00'),/FORBIDDEN/);
    await assert.rejects(store.create(2,5,'other department','2026-10-15T10:00:00+03:00'),/FORBIDDEN/);
    await store.create(1,5,'Finance private task','2026-10-15T10:00:00+03:00');
    await store.create(2,4,'Project task','2026-10-15T10:00:00+03:00');
    await assert.rejects(store.list(3,5),/FORBIDDEN/);
    await assert.rejects(store.list(3,undefined,true),/FORBIDDEN/);
    assert.equal((await store.list(2,undefined,true)).length,1);
    assert.equal((await store.list(1,undefined,true)).length,2);
    assert.equal((await store.list(1,undefined,true,true)).length,0);
    assert.equal((await store.list(3)).length,0);
  } finally { await pool.end(); }
});

test('date resolver uses Riyadh, rolls Friday, validates dates, ambiguity and hours', () => {
  assert.equal(riyadhToday(new Date('2026-10-14T22:30:00Z')),'2026-10-15');
  assert.match(schedule('بعد بكرة 13:00',now).error,/السبت.*خارج ساعات/);
  assert.equal(schedule('الأحد 10:00',now).date,'2026-10-18');
  assert.ok(schedule('2026-02-30 09:00',now).error);
  assert.ok(schedule('بكرة 25:00',now).error);
  assert.ok(schedule('2026-01-01 09:00',now).error);
  assert.ok(schedule('بكرة الجمعة 09:00',now).error);
  assert.ok(schedule('بكرة',now).error);
});

test('Groq adapter sends JSON mode and validates output; provider failures fail closed', async () => {
  let captured;
  const options = {baseURL:'https://api.groq.com/openai/v1',apiKey:'test-secret',model:'qwen/qwen3.8-27b'};
  const ai = createAI({...options,fetchImpl:async (url,request) => {
    captured={url:String(url),request};
    return {ok:true,json:async () => ({choices:[{message:{content:JSON.stringify(scenarios[0].intent)}}]})};
  }});
  assert.equal((await ai({message:scenarios[0].message,users:[],now})).action,'create_task');
  assert.equal(captured.url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(JSON.parse(captured.request.body).response_format.type,'json_schema');
  for (const response of [ {ok:false,status:429}, {ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})}, {ok:true,json:async()=>({choices:[{message:{content:'{"action":"drop_database"}'}}]})} ]) {
    await assert.rejects(createAI({...options,fetchImpl:async()=>response})({message:'hi',users:[],now}),AIError);
  }
});

test('HTTP API handles authentication, payload validation, unavailable AI, and role injection', async t => {
  const {pool,store} = await setup();
  const tokens = {'3':'a'.repeat(32)};
  const server = createServer({authMode:'token',tokens,chat:createChat({store,clock:()=>now,ai:async ({message}) => {
    if (message === 'offline') throw new AIError('unavailable');
    return {...base,action:'list_tasks',target:'company',role:'manager'};
  }})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
  const url = `http://127.0.0.1:${server.address().port}/chat`;
  const request = (body,auth=true) => fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${tokens['3']}`}:{})},body:JSON.stringify(body)});
  assert.equal((await request({user_id:3,message:'hi'},false)).status,401);
  assert.equal((await request({user_id:1,message:'hi'})).status,403);
  assert.equal((await request({user_id:3,message:''})).status,400);
  const injected=await request({user_id:3,message:scenarios[7].message});
  assert.equal(injected.status,403); assert.equal((await injected.json()).action_type,'rejection');
  assert.equal((await request({user_id:3,message:'offline'})).status,502);
  assert.equal((await fetch(url)).status,405);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${tokens['3']}`},body:'x'})).status,415);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${tokens['3']}`,'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await request({user_id:3,message:'x'.repeat(20000)})).status,413);
});

test('Vercel handler accepts pre-parsed bodies and guards authentication', async () => {
  const {createHandler} = await import('../src/http.js');
  let result;
  const response = () => ({writeHead(status){this.status=status;},end(body){result={status:this.status,body:JSON.parse(body)};},setHeader(){}});
  const handler = createHandler({authMode:'token',tokens:{'2':'b'.repeat(32)},chat:async () => ({action:'list_tasks',tasks:[],reply:'لا توجد مهام'})});
  const req={url:'/chat?test=1',method:'POST',headers:{authorization:`Bearer ${'b'.repeat(32)}`,'content-type':'application/json'},body:{user_id:2,message:'مهامي'}};
  await handler(req,response());assert.equal(result.status,200);assert.equal(result.body.action,'list_tasks');
  await handler({...req,body:{user_id:1,message:'مهامي'}},response());assert.equal(result.status,403);
  await handler({...req,body:{user_id:2,message:'x'.repeat(20000)}},response());assert.equal(result.status,413);
});

test('cloud runtime enforces token mode and verified database TLS', async () => {
  const {databaseConfig,createRuntime}=await import('../src/runtime.js');
  assert.throws(()=>createRuntime({VERCEL:'1',AUTH_MODE:'demo'}),/AUTH_MODE=token/);
  const config=databaseConfig({VERCEL:'1',DATABASE_URL:'postgres://test:test@example.com/app?sslmode=require',DATABASE_SSL:'true'});
  assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.max,3);
  assert.ok(!config.connectionString.includes('sslmode'));
});

test('working-hour enforcement covers boundaries, Saturday, Friday shifting and repository bypass',async()=>{
  for(const time of ['07:59','16:00','19:00','00:00']) assert.ok(workingHoursError(`2026-10-15T${time}:00+03:00`),time);
  for(const time of ['08:00','15:59']) assert.equal(workingHoursError(`2026-10-15T${time}:00+03:00`),undefined,time);
  for(const time of ['07:59','12:00','13:00']) assert.ok(workingHoursError(`2026-10-17T${time}:00+03:00`),time);
  for(const time of ['08:00','11:59']) assert.equal(workingHoursError(`2026-10-17T${time}:00+03:00`),undefined,time);
  assert.ok(workingHoursError('2026-10-16T09:00:00+03:00'));
  assert.equal(workingHoursError('2026-10-15T05:00:00Z'),undefined); // 08:00 Riyadh.
  assert.equal(schedule('الجمعة 09:00',now).shifted,true);
  assert.match(schedule('الجمعة 13:00',now).error,/الجمعة.*السبت.*خارج ساعات/);
  const {pool,store}=await setup();
  try {
    await assert.rejects(store.create(1,4,'outside','2026-10-15T19:00:00+03:00'),/OUTSIDE_WORKING_HOURS/);
    const chat=createChat({store,clock:()=>now,ai:async()=>({...base,action:'create_task',description:'outside',date_kind:'tomorrow',time:'19:00'})});
    assert.match((await chat({user_id:1,message:'outside'})).reply,/خارج ساعات/);
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,0);
  } finally {await pool.end();}
});

test('all six policy answers use the exact source clauses, and unsupported questions do not invent',async()=>{
  const {pool,store}=await setup();
  try {
    for(let id=1;id<=6;id++) {
      const chat=createChat({store,ai:async()=>({...base,action:'policy_question',policy_supported:true,policy_ids:[id]})});
      assert.equal((await chat({user_id:3,message:'policy'})).reply,policy[id-1]);
    }
    const chat=createChat({store,ai:async()=>({...base,action:'policy_question',policy_supported:false,policy_ids:[1]})});
    const result=await chat({user_id:3,message:'unknown'});
    assert.deepEqual(result.policy_ids,[]);assert.match(result.reply,/غير متوفرة/);
  } finally {await pool.end();}
});

test('chat exposes four response categories and classifies unknown policy as clarification',async()=>{
 const {pool,store}=await setup();
 try {
  const call=(user_id,intent)=>createChat({store,clock:()=>now,ai:async()=>({...base,...intent})})({user_id,message:'test classification'});
  assert.equal((await call(3,{action:'list_tasks'})).response_type,'execution');
  assert.equal((await call(3,{action:'create_task',target:'person',assignee_name:'خالد',description:'blocked'})).response_type,'rejection');
  const shifted=await call(3,{action:'create_task',description:'Friday example',date_kind:'weekday',date_value:'الجمعة',time:'09:00'});
  assert.equal(shifted.response_type,'execution_rescheduled');assert.equal(shifted.rescheduled,true);
  assert.equal((await call(3,{action:'create_task',description:'missing date'})).response_type,'clarification');
  assert.equal((await call(3,{action:'policy_question',policy_supported:false})).response_type,'clarification');
 } finally {await pool.end();}
});

 test('unqualified work hours infer afternoon while explicit early hours stay outside work',()=>{
 assert.equal(workTime('03:00','اليوم الساعة ٣'),'15:00');
 assert.equal(workTime('03:30','اليوم الساعة ثلاثة ونصف'),'15:30');
 for(const message of ['اليوم الساعة ٣ صباحا','اليوم الساعة 03:00','today 3 am']) assert.equal(workTime('03:00',message),'03:00');
 assert.equal(workTime('11:00','بكرة الساعة حداشر'),'11:00');
 assert.ok(workingHoursError('2026-10-17T15:00:00+03:00'));
 });

test('task schedule alone never becomes a work description or persisted task',async()=>{
 for(const text of ['', 'تتعمل الساعة ثلاثة','النهاردة الساعة ٣','schedule task at 3']) assert.equal(hasTaskDescription(text),false,text);
 assert.equal(hasTaskDescription('عمل تقرير شامل'),true);
 const {pool,store}=await setup();try {
 const chat=createChat({store,clock:()=>now,ai:async()=>({...base,action:'create_task',description:'تتعمل الساعة ثلاثة',date_kind:'today',time:'15:00'})});
 const result=await chat({user_id:3,message:'سجل مهمة النهاردة الساعة ثلاثة'});assert.equal(result.action_type,'inquiry');assert.match(result.message,/وصف المهمة/);assert.equal((await store.list(3)).length,0);
 }finally{await pool.end();}
});
