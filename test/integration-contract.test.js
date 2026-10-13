import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newDb} from 'pg-mem';
import {initialize,Store} from '../src/store.js';
import {createTelegram,identityRequest} from '../src/telegram.js';
import {createChat} from '../src/chat.js';
import {createHandler} from '../src/http.js';
import {classifyResponse} from '../src/responses.js';
import {base} from './scenarios.js';
const update=(n,text,id=700)=>({update_id:n,message:{from:{id,is_bot:false},chat:{id,type:'private'},text}});
async function fixture(ai=async()=>({...base,action:'clarify'})) {
 const Pool=newDb().adapters.createPg().Pool,pool=new Pool();await initialize(pool);let now=new Date('2026-10-14T09:00:00Z');const sent=[];
 const telegram=createTelegram({pool,ai,token:'123:test',secret:'s'.repeat(64),username:'example_bot',clock:()=>now,fetchImpl:async(url,options)=>{sent.push({method:url.split('/').at(-1),...JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};}});
 const send=async(n,text,id=700)=>{await telegram.receive(update(n,text,id));return sent.filter(m=>m.method==='sendMessage').at(-1);};
 const grant=async(user,id=700)=>{const link=await telegram.linkCode(user);return send(10000+sent.length,`/start ${new URL(link.url).searchParams.get('start')}`,id);};
 const callback=async(n,data,id=700)=>{await telegram.receive({update_id:n,callback_query:{id:`cb${n}`,from:{id,is_bot:false},message:{chat:{id,type:'private'}},data}});return sent.filter(m=>m.method==='sendMessage').at(-1);};
 return {pool,telegram,sent,send,grant,callback,expire:()=>{now=new Date('2026-10-16T09:00:00Z');}};
}
test('start greeting asks ID; valid verified identity is personalized with real role buttons; metadata stays hidden',async()=>{
 const f=await fixture();try {
  const welcome=await f.send(1,'/start');assert.match(welcome.text,/أهلاً.*User ID/);
  assert.match((await f.send(2,'999')).text,/غير موجود/);
  assert.match((await f.send(3,'5')).text,/غير مصرح/);
  const greeting=await f.grant(5);assert.match(greeting.text,/نورة/);assert.ok(greeting.reply_markup.inline_keyboard.length);
  assert.ok(!greeting.reply_markup.inline_keyboard.flat().some(b=>b.text==='طلبات للاعتماد'));
  assert.doesNotMatch(greeting.text,/action_type|^تنفيذ\n/);
 }finally{await f.pool.end();}
});
test('verified multiple accounts switch naturally; rejected switch preserves active context and pending history',async()=>{
 const f=await fixture();try {
  await f.grant(4);await f.grant(5);await f.send(1,'Use User ID 4');await f.send(2,'أنشئ مهمة');
  const before=(await f.pool.query('SELECT * FROM telegram_conversations')).rows[0];
  assert.match((await f.send(3,'Change my User ID to 6')).text,/غير مصرح/);
  assert.equal((await f.pool.query('SELECT active_user_id FROM telegram_sessions')).rows[0].active_user_id,4);
  assert.deepEqual((await f.pool.query('SELECT messages FROM telegram_conversations')).rows[0].messages,before.messages);
  assert.match((await f.send(4,'رقمي التعريفي ٥')).text,/نورة/);
  assert.equal((await f.pool.query('SELECT * FROM telegram_conversations')).rows.length,0);
  assert.equal((await f.pool.query('SELECT current_action FROM telegram_sessions')).rows[0].current_action,null);
 }finally{await f.pool.end();}
});
test('old callbacks cannot execute after identity switch and arbitrary numbers are not identities',async()=>{
 const f=await fixture();try {
  const greeting=await f.grant(4);const button=greeting.reply_markup.inline_keyboard.flat().find(b=>b.text==='إنشاء مهمة');
  const inquiry=await f.callback(1,button.callback_data);assert.match(inquiry.text,/وصف المهمة/);
  await f.grant(5);assert.match((await f.callback(2,button.callback_data)).text,/قديم/);
  await f.send(3,'4');assert.equal((await f.pool.query('SELECT active_user_id FROM telegram_sessions')).rows[0].active_user_id,5);
  assert.equal((await f.pool.query('SELECT * FROM tasks')).rows.length,0);
  for(const text of ['مصروفات 500 ريال','المهمة 5','500','اعتمد الطلب رقم 6']) assert.equal(identityRequest(text,false),undefined);
  assert.equal(identityRequest('غير الـ ID إلى ٦',false),6);
 }finally{await f.pool.end();}
});
test('isolated chats and expired sessions cannot use another account or stale buttons',async()=>{
 const seen=[];const f=await fixture(async({history})=>{seen.push(history);return {...base,action:'clarify'};});try {
  const greeting=await f.grant(4);await f.grant(5,701);await f.send(1,'أول محادثة');await f.send(2,'ثاني محادثة',701);
  assert.deepEqual(seen,[[],[]]);assert.equal((await f.pool.query('SELECT * FROM telegram_sessions')).rows.length,2);
  f.expire();assert.match((await f.callback(3,greeting.reply_markup.inline_keyboard[0][0].callback_data)).text,/انتهت/);
  assert.equal((await f.pool.query('SELECT active_user_id FROM telegram_sessions WHERE telegram_id=700')).rows[0].active_user_id,null);
 }finally{await f.pool.end();}
});
test('API prompt and Telegram buttons share read logic; every HTTP success/error has the five-category envelope',async()=>{
 const f=await fixture();try {
  const handler=createHandler({authMode:'token',tokens:{4:'a'.repeat(64)},chat:createChat({store:new Store(f.pool),ai:async()=>({...base,action:'list_tasks'})})});
  async function request(body,extra={}) {let status,data;await handler({url:'/chat',method:'POST',headers:{authorization:`Bearer ${'a'.repeat(64)}`,'content-type':'application/json'},body,...extra},{setHeader(){},writeHead(n){status=n;},end(raw){data=JSON.parse(raw);}});assert.equal(typeof data.action,'string');assert.equal(typeof data.message,'string');assert.ok(['execution','rejection','postpone','inquiry','exception'].includes(data.action_type));return {status,data};}
  const greeting=await f.grant(4);const reply=await f.callback(1,greeting.reply_markup.inline_keyboard[0][0].callback_data);
  const success=await request({user_id:4,prompt:'show my tasks'});assert.equal(success.data.message,reply.text);assert.equal(success.data.action,'list_tasks');
  assert.equal((await request({prompt:'hello'})).status,400);
  assert.equal((await request({user_id:5,prompt:'hello'})).status,403);
  assert.equal((await request('{')).status,400);
  assert.equal((await request({}, {method:'GET'})).status,405);
  assert.equal((await request({}, {url:'/missing'})).status,404);
  assert.equal((await request({}, {headers:{}})).status,401);
  const broken=createHandler({chat:async()=>{throw new Error('private password');}});let result;await broken({url:'/chat',method:'POST',headers:{'content-type':'application/json'},body:{user_id:4,prompt:'hello'}},{writeHead(){},end(raw){result=JSON.parse(raw);}});
  assert.equal(result.action_type,'exception');assert.doesNotMatch(result.message,/password/);
  for(const [input,type] of [[{action:'create_task'},'execution'],[{action:'reject'},'rejection'],[{action:'create_task',rescheduled:true},'postpone'],[{action:'clarify'},'inquiry'],[{action:'error'},'exception']]) assert.equal(classifyResponse(input).action_type,type);
 }finally{await f.pool.end();}
});

test('explicit demo mode accepts ID-only selection without creating verified grants',async()=>{
 const Pool=newDb().adapters.createPg().Pool,pool=new Pool();await initialize(pool);const sent=[];
 try {
  const telegram=createTelegram({pool,identityMode:'demo_id',token:'123:test',secret:'s'.repeat(64),username:'example_bot',ai:async()=>({...base,action:'clarify'}),fetchImpl:async(_url,o)=>{sent.push(JSON.parse(o.body));return {ok:true,json:async()=>({ok:true})};}});
  await telegram.receive(update(1,'/start'));await telegram.receive(update(2,'5'));
  assert.match(sent.at(-1).text,/نورة/);assert.ok(sent.at(-1).reply_markup.inline_keyboard.length);
  assert.equal((await pool.query('SELECT * FROM telegram_access')).rows.length,0);
  assert.equal((await pool.query('SELECT identity_mode FROM telegram_bindings')).rows[0].identity_mode,'demo_id');
  await pool.query("INSERT INTO telegram_access (telegram_id,employee_id) SELECT telegram_id,employee_id FROM telegram_bindings WHERE identity_mode='secure_link' ON CONFLICT (telegram_id,employee_id) DO NOTHING");assert.equal((await pool.query('SELECT * FROM telegram_access')).rows.length,0);
 }finally{await pool.end();}
});

test('medical upload button requests only a file and reminds of dates inside the report',async()=>{
 const f=await fixture(async()=>({...base,action:'submit_report'}));
 try {
  const greeting=await f.grant(5);
  assert.ok(greeting.reply_markup.inline_keyboard.flat().some(b=>b.text==='تسجيل العودة من المرضية'));
  const button=greeting.reply_markup.inline_keyboard.flat().find(b=>b.text==='إرفاق تقرير طبي');
  const prompt=await f.callback(1,button.callback_data);assert.match(prompt.text,/خلال يومين كحد أقصى/);assert.doesNotMatch(prompt.text,/حدد رقم|اذكر تاريخ|ما تاريخ/);
  await f.telegram.receive({update_id:2,message:{from:{id:700,is_bot:false},chat:{id:700,type:'private'},document:{file_id:'medical-file',file_size:512,mime_type:'application/pdf'}}});
  const receipt=f.sent.filter(m=>m.method==='sendMessage').at(-1);assert.match(receipt.text,/تم استلام تقريرك/);
  const row=(await f.pool.query('SELECT * FROM employee_requests')).rows[0];
  assert.equal(row.employee_id,5);assert.equal(row.approver_id,null);assert.equal(row.monitor_id,6);assert.equal(row.request_date,null);assert.equal(row.report_deadline,null);assert.equal(row.status,'report_received');
 }finally{await f.pool.end();}
});

test('return button records today and report upload uses that record without asking date or ID',async()=>{
 const f=await fixture(async()=>({...base,action:'submit_report'}));
 try {
  const greeting=await f.grant(5);
  const button=greeting.reply_markup.inline_keyboard.flat().find(b=>b.text==='تسجيل العودة من المرضية');
  await f.callback(1,button.callback_data);
  const before=(await f.pool.query('SELECT * FROM employee_requests')).rows[0];
  assert.equal(new Date(before.request_date).toISOString().slice(0,10),'2026-10-14');assert.equal(new Date(before.report_deadline).toISOString().slice(0,10),'2026-10-16');assert.equal(before.approver_id,null);
  await f.telegram.receive({update_id:2,message:{from:{id:700,is_bot:false},chat:{id:700,type:'private'},document:{file_id:'return-report',file_size:512,mime_type:'application/pdf'}}});
  const rows=(await f.pool.query('SELECT * FROM employee_requests')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].status,'report_received');assert.equal(rows[0].monitor_id,6);
 }finally{await f.pool.end();}
});

test('new-request menu has exactly three choices with type-specific inquiries and saved annual range',async()=>{
 const f=await fixture(async()=>({...base,action:'create_request',request_type:'annual_leave',date_kind:'absolute',date_value:'2026-10-20',end_date_kind:'absolute',end_date_value:'2026-10-22'}));
 try {
  const greeting=await f.grant(5),buttons=greeting.reply_markup.inline_keyboard.flat();
  const menu=await f.callback(1,buttons.find(b=>b.text==='طلب جديد').callback_data);
  assert.deepEqual(menu.reply_markup.inline_keyboard.flat().map(b=>b.text),['إجازة اعتيادية','عمل عن بُعد','مصروفات']);
  const annual=menu.reply_markup.inline_keyboard.flat()[0];assert.match((await f.callback(2,annual.callback_data)).text,/من أي يوم إلى أي يوم/);
  const created=await f.send(3,'من 2026-10-20 إلى 2026-10-22');assert.match(created.text,/بانتظار/);
  const row=(await f.pool.query('SELECT * FROM employee_requests')).rows[0];assert.equal(new Date(row.end_date).toISOString().slice(0,10),'2026-10-22');assert.equal(row.approver_id,6);
  assert.match((await f.callback(4,menu.reply_markup.inline_keyboard.flat()[1].callback_data)).text,/في أي يوم/);
  assert.match((await f.callback(5,menu.reply_markup.inline_keyboard.flat()[2].callback_data)).text,/قيمة المصروفات/);
 }finally{await f.pool.end();}
});

test('supervisor assignment notification appears once on employee login and stays scoped to recipient',async()=>{
 const f=await fixture();try {
  const store=new Store(f.pool);
  await store.create(2,4,'مراجعة مخططات','2026-10-15T10:00:00+03:00');
  await store.create(1,5,'مراجعة مالية','2026-10-15T10:00:00+03:00');
  await store.create(4,4,'مهمة لنفسي','2026-10-15T11:00:00+03:00');
  assert.equal((await f.pool.query('SELECT * FROM task_notifications')).rows.length,2);
  const reply=await f.grant(4);assert.match(reply.text,/المشرف سارة أسند لك مهمة/);assert.match(reply.text,/مراجعة مخططات/);assert.doesNotMatch(reply.text,/مراجعة مالية/);
  const again=await f.send(1,'Use User ID 4');assert.doesNotMatch(again.text,/إشعاراتك الجديدة/);
  assert.equal((await store.list(4)).length,2);assert.equal((await f.pool.query('SELECT * FROM tasks')).rows.length,3);
  const other=await f.grant(5,701);assert.match(other.text,/المدير منيرة أسند لك مهمة/);assert.doesNotMatch(other.text,/مراجعة مخططات/);
 }finally{await f.pool.end();}
});
