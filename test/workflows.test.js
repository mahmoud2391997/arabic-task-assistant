import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {newDb} from 'pg-mem';
import {initialize,Store} from '../src/store.js';
import {executeWorkflow,WorkflowError} from '../src/workflows.js';
import {createChat} from '../src/chat.js';
import {base} from './scenarios.js';

const now=new Date('2026-10-13T09:00:00Z');
const intent=overrides=>({...base,request_type:'',record_id:null,status:'',amount:null,currency:'',duration_days:null,...overrides});
async function setup() {
 const schema=`workflows_${Date.now()}_${Math.floor(Math.random()*100000)}`;
 const url=process.env.WORKFLOW_TEST_DATABASE_URL;
 const admin=url ? new pg.Pool({connectionString:url}) : null;
 if(admin) await admin.query(`CREATE SCHEMA ${schema}`);
 const Pool=admin ? pg.Pool : newDb().adapters.createPg().Pool;
 const pool=new Pool(admin ? {connectionString:url,options:`-c search_path=${schema}`} : {});
 await initialize(pool);const store=new Store(pool);
 return {pool,store,run:(userId,data,clock=now,document)=>executeWorkflow({store,userId,intent:intent(data),now:clock,document}),close:async()=>{await pool.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}};
}

test('annual leave requires five business days and direct supervisor approval',async()=>{
 const {pool,run,close}=await setup();
 try {
  await assert.rejects(run(4,{action:'create_request',request_type:'annual_leave',date_kind:'business_days',date_value:'3'}),/5 أيام عمل/);
  assert.equal((await pool.query('SELECT * FROM employee_requests')).rows.length,0);
  const result=await run(4,{action:'create_request',request_type:'annual_leave',date_kind:'business_days',date_value:'5'});
  assert.equal(result.request.approver_id,2);assert.equal(result.request.status,'pending');
  assert.equal(result.request.request_date,'2026-10-19');
  const id=result.request.id;
  await assert.rejects(run(4,{action:'decide_request',record_id:id,status:'approved'}),WorkflowError);
  await assert.rejects(run(6,{action:'decide_request',record_id:id,status:'approved'}),WorkflowError);
  assert.equal((await run(2,{action:'decide_request',record_id:id,status:'approved'})).request.status,'approved');
  await assert.rejects(run(2,{action:'decide_request',record_id:id,status:'approved'}),/قراراً بالفعل/);
  assert.equal((await run(6,{action:'list_requests'})).requests.length,0);
  assert.equal((await run(2,{action:'list_approvals'})).requests.length,0);
  assert.equal((await run(4,{action:'list_requests'})).requests.length,1);
 } finally {await close();}
});

test('remote work stays pending until supervisor approval and permits one approved day per week',async()=>{
 const {run,close}=await setup();
 try {
  await assert.rejects(run(4,{action:'create_request',request_type:'remote_work',date_kind:'tomorrow',duration_days:2}),/يوم واحد/);
  const a=await run(4,{action:'create_request',request_type:'remote_work',date_kind:'tomorrow',duration_days:1});
  const b=await run(4,{action:'create_request',request_type:'remote_work',date_kind:'day_after_tomorrow',duration_days:1});
  assert.equal(a.request.status,'pending');assert.equal(a.request.approver_id,2);
  await assert.rejects(run(1,{action:'decide_request',record_id:a.request.id,status:'approved'}),/صلاحية/);
  await run(2,{action:'decide_request',record_id:a.request.id,status:'approved'});
  await assert.rejects(run(2,{action:'decide_request',record_id:b.request.id,status:'approved'}),/يوم ثان/);
  await assert.rejects(run(4,{action:'create_request',request_type:'remote_work',date_kind:'day_after_tomorrow'}),/معتمد/);
  const c=await run(4,{action:'create_request',request_type:'remote_work',date_kind:'absolute',date_value:'2026-10-18'});
  assert.equal((await run(2,{action:'decide_request',record_id:c.request.id,status:'approved'})).request.status,'approved');
 } finally {await close();}
});

test('expenses route 500 to supervisor, over 500 to manager, and cannot be self approved',async()=>{
 const {run,pool,close}=await setup();
 try {
  const a=await run(4,{action:'create_request',request_type:'expense',amount:500,currency:'SAR'});
  const b=await run(4,{action:'create_request',request_type:'expense',amount:500.01,currency:'SAR'});
  assert.equal(a.request.approver_id,2);assert.equal(b.request.approver_id,1);
  await assert.rejects(run(2,{action:'decide_request',record_id:b.request.id,status:'approved'}),/صلاحية/);
  await assert.rejects(run(1,{action:'decide_request',record_id:a.request.id,status:'approved'}),/صلاحية/);
  assert.equal((await run(2,{action:'decide_request',record_id:a.request.id,status:'approved'})).request.status,'approved');
  assert.equal((await run(1,{action:'decide_request',record_id:b.request.id,status:'rejected'})).request.status,'rejected');
  await assert.rejects(run(4,{action:'create_request',request_type:'expense',amount:-5,currency:'SAR'}),/مبلغ/);
  await assert.rejects(run(4,{action:'create_request',request_type:'expense',amount:5,currency:''}),/مبلغ/);
  const actions=(await pool.query('SELECT action FROM audit_log')).rows.map(r=>r.action);
  assert.equal(actions.filter(a=>a==='create_request').length,2);assert.equal(actions.filter(a=>a==='decide_request').length,2);
 } finally {await close();}
});

test('medical reports require an attachment, show missing after two days, accept late receipt without invented penalties',async()=>{
 const {run,close}=await setup();
 try {
  const a=await run(4,{action:'create_request',request_type:'sick_leave',date_kind:'absolute',date_value:'2026-10-13'});
  const id=a.request.id;assert.equal(a.request.report_deadline,'2026-10-15');
  assert.equal(a.request.status,'awaiting_report');
  assert.equal((await run(4,{action:'list_requests'},new Date('2026-10-15T20:59:00Z'))).requests[0].status,'awaiting_report');
  assert.equal((await run(4,{action:'list_requests'},new Date('2026-10-15T21:00:00Z'))).requests[0].status,'report_overdue');
  await assert.rejects(run(4,{action:'submit_report',record_id:id}),/أرفق ملف/);
  const file={file_id:'test_report_reference',mime_type:'application/pdf',file_size:100};
  await assert.rejects(run(3,{action:'submit_report',record_id:id},now,file),/صلاحية/);
  const late=await run(4,{action:'submit_report',record_id:id},new Date('2026-10-16T06:00:00Z'),file);
  assert.equal(late.request.status,'report_received_late');assert.equal(late.request.report_file_id,undefined);
  assert.match(late.reply,/لا تحدد عقوبة/);
 } finally {await close();}
});

test('task status changes only during its day and working hours, using server clock and scoped roles',async()=>{
 const {run,store,pool,close}=await setup();
 try {
  const task=await store.create(2,4,'status test','2026-10-13T10:00:00+03:00');
  const update={action:'update_task',record_id:task.id,status:'completed'};
  await assert.rejects(run(3,update),/صلاحية/);
  await assert.rejects(run(4,update,new Date('2026-10-13T13:00:00Z')),/خارج الدوام/);
  await assert.rejects(run(4,update,new Date('2026-10-14T06:00:00Z')),/يوم المهمة/);
  assert.equal((await run(4,update,new Date('2026-10-13T12:59:00Z'))).task.status,'completed');
  const saturday=await store.create(2,4,'Saturday status','2026-10-17T10:00:00+03:00');
  await assert.rejects(run(4,{...update,record_id:saturday.id},new Date('2026-10-17T09:00:00Z')),/خارج الدوام/);
  assert.equal((await run(4,{...update,record_id:saturday.id},new Date('2026-10-17T08:59:00Z'))).task.status,'completed');
  const audits=(await pool.query("SELECT details FROM audit_log WHERE action='update_task'")).rows;
  assert.equal(audits.length,2);assert.ok(audits[0].details.updated_at);
 } finally {await close();}
});

test('chat dispatches expense intent to requests instead of creating a task',async()=>{
 const {store,pool,close}=await setup();
 try {
  const chat=createChat({store,clock:()=>now,ai:async()=>intent({action:'create_request',request_type:'expense',amount:650,currency:'SAR'})});
  const result=await chat({user_id:4,message:'مصروفات 650 ريال'});
  assert.equal(result.action,'create_request');assert.equal(result.request.approver_id,1);
  assert.equal((await pool.query('SELECT * FROM tasks')).rows.length,0);
 } finally {await close();}
});

test('concurrent approvals cannot grant two remote-work days in one week',{skip:!process.env.WORKFLOW_TEST_DATABASE_URL},async()=>{
 const {run,pool,close}=await setup();
 try {
  const a=await run(4,{action:'create_request',request_type:'remote_work',date_kind:'tomorrow'});
  const b=await run(4,{action:'create_request',request_type:'remote_work',date_kind:'day_after_tomorrow'});
  const results=await Promise.allSettled([run(2,{action:'decide_request',record_id:a.request.id,status:'approved'}),run(2,{action:'decide_request',record_id:b.request.id,status:'approved'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await pool.query("SELECT * FROM employee_requests WHERE request_type='remote_work' AND status='approved'")).rows.length,1);
 } finally {await close();}
});

test('approval inboxes separate manager and supervisor pending requests from own applications',async()=>{
 const {run,close}=await setup();
 try {
  const expense=await run(4,{action:'create_request',request_type:'expense',amount:650,currency:'SAR'});
  const small=await run(4,{action:'create_request',request_type:'expense',amount:500,currency:'SAR'});
  const leave=await run(4,{action:'create_request',request_type:'annual_leave',date_kind:'business_days',date_value:'5'});
  const remote=await run(4,{action:'create_request',request_type:'remote_work',date_kind:'tomorrow'});
  const manager=await run(1,{action:'list_approvals'});
  assert.deepEqual(manager.requests.map(r=>r.id),[expense.request.id]);
  assert.match(manager.reply,/خالد/);assert.match(manager.reply,/650/);
  const supervisor=await run(2,{action:'list_approvals'});
  assert.deepEqual(supervisor.requests.map(r=>r.id),[remote.request.id,leave.request.id,small.request.id]);
  assert.equal((await run(4,{action:'list_approvals'})).requests.length,0);
  assert.equal((await run(2,{action:'list_requests'})).requests.length,0);
  await run(1,{action:'decide_request',record_id:expense.request.id,status:'approved'});
  assert.equal((await run(1,{action:'list_approvals'})).requests.length,0);
 } finally {await close();}
});

test('supervisor medical monitoring is separate from approvals and scoped to assigned department',async()=>{
 const {run,close}=await setup();
 try {
  const sick=await run(4,{action:'create_request',request_type:'sick_leave',date_kind:'absolute',date_value:'2026-10-10'});
  assert.equal(sick.request.monitor_id,2);assert.equal(sick.request.approver_id,null);
  const reports=await run(2,{action:'list_reports'});
  assert.equal(reports.requests.length,1);assert.equal(reports.requests[0].status,'report_overdue');
  assert.match(reports.reply,/خالد/);assert.match(reports.reply,/متأخر/);
  assert.equal((await run(2,{action:'list_approvals'})).requests.length,0);
  assert.equal((await run(6,{action:'list_reports'})).requests.length,0);
  await assert.rejects(run(4,{action:'list_reports'}),/للمشرف/);
  await assert.rejects(run(2,{action:'decide_request',record_id:sick.request.id,status:'approved'}),/صلاحية/);
 } finally {await close();}
});

test('direct menu commands keep SQL permissions without accepting claimed authority',async()=>{
 const {store,close}=await setup();
 try {
  const chat=createChat({store,clock:()=>now,ai:async()=>assert.fail('Menu commands should not call provider')});
  assert.equal((await chat({user_id:4,message:'طلبات للاعتماد'})).requests.length,0);
  assert.equal((await chat({user_id:4,message:'متابعة التقارير'})).action_type,'rejection');
  assert.equal((await chat({user_id:4,message:'كل المهام'})).action_type,'rejection');
  assert.equal((await chat({user_id:4,message:'سياسة الشركة'})).policy_ids.length,6);
 } finally {await close();}
});

test('task-update inquiry lists only tasks in the actor scope before asking for number and status',async()=>{
 const {store,close}=await setup();
 try {
  await store.create(1,4,'مشاريع مسموحة','2026-10-15T10:00:00+03:00');
  await store.create(1,5,'مالية خاصة','2026-10-15T10:00:00+03:00');
  const chat=createChat({store,clock:()=>now,ai:async()=>({...base,action:'update_task'})});
  const own=await chat({user_id:4,message:'أبي أحدث حالة مهمة'});
  assert.equal(own.action_type,'inquiry');assert.equal(own.tasks.length,1);assert.match(own.message,/اختر رقم المهمة/);assert.doesNotMatch(own.message,/مالية خاصة/);
  const supervisor=await chat({user_id:2,message:'تحديث مهمة'});assert.equal(supervisor.tasks.length,1);
  const manager=await chat({user_id:1,message:'تحديث مهمة'});assert.equal(manager.tasks.length,2);
  assert.ok(manager.tasks.every(t=>t.status==='pending'));
 }finally{await close();}
});
