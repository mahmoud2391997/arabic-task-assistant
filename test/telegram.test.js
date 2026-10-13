import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {newDb} from 'pg-mem';
import {initialize} from '../src/store.js';
import {createTelegram} from '../src/telegram.js';
import {createHandler} from '../src/http.js';
import {base} from './scenarios.js';

const secret='s'.repeat(64);
const message=(update_id,text,id=1001) => ({update_id,message:{from:{id,is_bot:false},chat:{id,type:'private'},text}});
test('Telegram authenticates webhooks, links once, keeps employee scope and deduplicates retries',{skip:!process.env.TELEGRAM_TEST_DATABASE_URL},async()=>{
  const schema=`telegram_test_${Date.now()}`;
  const admin=process.env.TELEGRAM_TEST_DATABASE_URL ? new pg.Pool({connectionString:process.env.TELEGRAM_TEST_DATABASE_URL}) : null;
  if(admin) await admin.query(`CREATE SCHEMA ${schema}`);
  const Pool=admin ? pg.Pool : newDb().adapters.createPg().Pool;
  const pool=new Pool(admin ? {connectionString:process.env.TELEGRAM_TEST_DATABASE_URL,options:`-c search_path=${schema}`} : {});
  try {
    await initialize(pool);
    let calls=0,failDelivery=false; const replies=[];
    const telegram=createTelegram({pool,token:'123:testing',secret,username:'example_bot',
      ai:async()=>{calls++; return {...base,action:'create_task',target:'self',description:'مهمة الاختبار',date_kind:'tomorrow',time:'10:00'};},
      fetchImpl:async(_url,options)=>{if(failDelivery) throw new Error('network');replies.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,result:{}})};}});
    assert.equal(telegram.authorize(secret),true);
    assert.equal(telegram.authorize('wrong'),false);
    const handler=createHandler({telegram,authMode:'token',tokens:{3:'e'.repeat(64)},chat:async()=>assert.fail()});
    async function request(path,headers,body) {let status,result;await handler({url:path,method:'POST',headers:{'content-type':'application/json',...headers},body},{setHeader(){},writeHead(n){status=n},end(data){result=JSON.parse(data)}});return {status,result};}
    assert.equal((await request('/telegram/webhook',{},message(1,'مهامي'))).status,401);
    assert.equal((await request('/telegram/link-code',{},{})).status,401);
    const link=(await request('/telegram/link-code',{authorization:`Bearer ${'e'.repeat(64)}`},{})).result;
    const code=new URL(link.url).searchParams.get('start');
    assert.equal((await pool.query('SELECT code_hash FROM telegram_link_codes')).rows[0].code_hash.includes(code),false);
    await telegram.receive(message(1,`/start ${code}`));
    assert.match(replies.at(-1).text,/فهد/);
    await telegram.receive(message(2,`/start ${code}`,1002));
    assert.match(replies.at(-1).text,/غير صالح/);
    await telegram.receive(message(3,'سجل مهمة لنفسي'));
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,1);
    const callsBefore=calls;
    await telegram.receive(message(3,'سجل مهمة لنفسي'));
    assert.equal(calls,callsBefore);
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,1);
    failDelivery=true;
    await assert.rejects(telegram.receive(message(4,'سجل مهمة لنفسي')),/transport failed/);
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,2);
    failDelivery=false;
    await telegram.receive(message(4,'سجل مهمة لنفسي'));
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,2);
    await telegram.receive(message(5,'سجل مهمة لنفسي',1002));
    assert.match(replies.at(-1).text,/ربط/);
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,2);
    const count=replies.length;
    const group=message(6,'مهامي');group.message.chat.type='group';
    await telegram.receive(group);
    const forged=message(7,'مهامي');forged.message.chat.id=9999;
    await telegram.receive(forged);
    assert.equal(replies.length,count);
    if(admin) {
      await Promise.all([telegram.receive(message(8,'سجل مهمة لنفسي')),telegram.receive(message(8,'سجل مهمة لنفسي'))]);
      assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,3);
    }
  } finally {await pool.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
});

test('public Telegram policy answers never get employee data or access tasks',async()=>{
  const Pool=newDb().adapters.createPg().Pool;const pool=new Pool();await initialize(pool);
  const replies=[];
  try {
    const telegram=createTelegram({pool,token:'123:test',secret,username:'example_bot',
      ai:async({users})=>{assert.deepEqual(users,[]);return {...base,action:'policy_question',policy_supported:true,policy_ids:[1]};},
      fetchImpl:async(_url,options)=>{replies.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};}});
    await telegram.receive(message(10,'ما مواعيد العمل؟'));
    assert.match(replies[0].text,/الدوام/);
    assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,0);
  } finally {await pool.end();}
});

test('demo ID flow asks for ID, resolves database role, and supports separate chats',async()=>{
  const Pool=newDb().adapters.createPg().Pool;const pool=new Pool();await initialize(pool);const replies=[];
  try {
    const telegram=createTelegram({pool,token:'123:test',secret,username:'example_bot',identityMode:'demo_id',
      ai:async()=>({...base,action:'list_tasks',target:'self'}),
      fetchImpl:async(_url,options)=>{replies.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};}});
    await telegram.receive(message(20,'/start'));
    assert.match(replies.at(-1).text,/رقم الموظف/);
    await telegram.receive(message(21,'999'));
    assert.match(replies.at(-1).text,/غير موجود/);
    await telegram.receive(message(22,'3'));
    assert.match(replies.at(-1).text,/فهد/);
    await telegram.receive(message(23,'3',1002));
    assert.match(replies.at(-1).text,/فهد/);
    await telegram.receive(message(24,'مهامي'));
    assert.match(replies.at(-1).text,/لا توجد مهام/);
    assert.equal((await pool.query('SELECT * FROM telegram_bindings')).rows.length,2);
  } finally {await pool.end();}
});

test('Telegram request retries commit a single request and audit',{skip:!process.env.TELEGRAM_TEST_DATABASE_URL},async()=>{
 const schema=`telegram_requests_${Date.now()}`;
 const admin=new pg.Pool({connectionString:process.env.TELEGRAM_TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.TELEGRAM_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try {
  await initialize(pool);
  const telegram=createTelegram({pool,token:'123:test',secret,username:'example_bot',identityMode:'demo_id',
    ai:async()=>({...base,action:'create_request',request_type:'expense',amount:650,currency:'SAR'}),
    fetchImpl:async()=>({ok:true,json:async()=>({ok:true})})});
  await telegram.receive(message(100,'4'));
  const update=message(101,'قدم طلب مصروفات 650 ريال');
  await Promise.all([telegram.receive(update),telegram.receive(update)]);
  assert.equal((await pool.query('SELECT * FROM employee_requests')).rows.length,1);
  assert.equal((await pool.query("SELECT * FROM audit_log WHERE action='create_request'")).rows.length,1);
 } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
