import {canAccess} from './store.js';
import {dateFromIntent,riyadhToday,businessDaysBetween,weekStart,addCalendarDays,workingHoursError} from './language.js';

export class WorkflowError extends Error {
  constructor(message,forbidden=false,rejection=false) {super(message);this.forbidden=forbidden;this.rejection=forbidden||rejection;}
}
const names={annual_leave:'إجازة اعتيادية',sick_leave:'إجازة مرضية',remote_work:'عمل عن بُعد',expense:'مصروفات'};
const statuses={pending:'بانتظار الموافقة',approved:'معتمد',rejected:'مرفوض',awaiting_report:'بانتظار التقرير الطبي',report_received:'التقرير مستلم',report_overdue:'التقرير متأخر',report_received_late:'التقرير مستلم بعد الموعد'};
const dateOnly=value=>value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
async function transaction(store,fn) {
  if(store.transactional) return fn(store.pool);
  const client=await store.pool.connect();
  try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
async function employee(client,id,lock='FOR SHARE') {
  const user=(await client.query(`SELECT * FROM employees WHERE id=$1 ${lock}`,[id])).rows[0];
  if(!user) throw new WorkflowError('الموظف غير موجود.',true);return user;
}
async function audit(client,actor,action,details) {
  await client.query('INSERT INTO audit_log (actor_id,action,details) VALUES ($1,$2,$3)',[actor,action,JSON.stringify(details)]);
}
async function approver(client,actor,type,amount) {
  const result= type==='expense'&&amount>500
    ? await client.query("SELECT * FROM employees WHERE role='manager' AND id<>$1 ORDER BY id",[actor.id])
    : await client.query("SELECT * FROM employees WHERE role='supervisor' AND department=$1 AND id<>$2 ORDER BY id",[actor.department,actor.id]);
  if(result.rows.length!==1) throw new WorkflowError('لا يوجد معتمِد واحد محدد لهذا الطلب. يلزم إعداد المشرف المباشر أو المدير في بيانات الموظفين.');
  return result.rows[0];
}
function publicRequest(row,now) {
  const result={...row};delete result.report_file_id;
  if(result.request_date) result.request_date=dateOnly(result.request_date);
  if(result.report_deadline) result.report_deadline=dateOnly(result.report_deadline);
  if(result.status==='awaiting_report'&&result.report_deadline<riyadhToday(now)) result.status='report_overdue';
  return result;
}
function describe(row) {
  return `#${row.id} ${names[row.request_type]}${row.employee_name?` — ${row.employee_name}`:''} — ${statuses[row.status]}${row.request_date ? ` — ${row.request_type==='sick_leave'?'العودة ':''}${row.request_date}` : ''}${row.amount ? ` — ${row.amount} ريال` : ''}${row.approver_id ? ` — المعتمد ${row.approver_name||`رقم ${row.approver_id}`}` : ''}${row.report_deadline ? ` — مهلة التقرير ${row.report_deadline}` : ''}`;
}
export async function executeWorkflow({store,userId,intent,now,document}) {
  return transaction(store,async client=>{
    const actor=await employee(client,userId);
    if (['list_requests','list_approvals','list_reports'].includes(intent.action)) {
      const reports=intent.action==='list_reports';
      if (reports && actor.role!=='supervisor') throw new WorkflowError('متابعة التقارير الطبية للمشرف المختص فقط.',true);
      const approvals=intent.action==='list_approvals';
      const condition=reports ? "r.monitor_id=$1 AND r.request_type='sick_leave' AND e.department=$2" : approvals ? "r.approver_id=$1 AND r.status='pending'" : 'r.employee_id=$1';
      const rows=(await client.query(`SELECT r.*,e.name AS employee_name,a.name AS approver_name
        FROM employee_requests r JOIN employees e ON e.id=r.employee_id LEFT JOIN employees a ON a.id=r.approver_id
        WHERE ${condition} ORDER BY r.id DESC`,reports ? [actor.id,actor.department] : [actor.id])).rows.map(r=>publicRequest(r,now));
      await audit(client,actor.id,intent.action,{count:rows.length});
      return {action:intent.action,requests:rows,reply:rows.length ? (reports?'متابعة التقارير الطبية:\n':approvals?'طلبات بانتظار اعتمادك:\n':'طلباتك:\n')+rows.map(describe).join('\n') : (reports?'لا توجد تقارير طبية لمتابعتها في قسمك.':approvals?'لا توجد طلبات بانتظار اعتمادك.':'لا توجد طلبات لك.')};
    }
    if (['decide_request','submit_report','update_task'].includes(intent.action) && !Number.isSafeInteger(intent.record_id)) throw new WorkflowError(intent.action==='submit_report'?'حدد رقم سجل العودة من الإجازة المرضية لإرفاق التقرير به. هذا ليس طلب موافقة أو رقم مهمة.':intent.action==='update_task'?'حدد رقم المهمة المطلوب تحديثها.':'حدد رقم طلب الاعتماد.');
    if(intent.action==='create_request') {
      if (intent.target !== 'self') throw new WorkflowError('طلبات الإجازة والعمل عن بعد والمصروفات تُقدّم لحسابك فقط.',false,true);
      const type=intent.request_type;
      if(!Object.hasOwn(names,type)) throw new WorkflowError('حدد نوع الطلب: إجازة اعتيادية، عمل عن بُعد، أو مصروفات. المرضية لا تحتاج إذناً مسبقاً؛ سجّل تاريخ العودة منها ثم أرفق التقرير الطبي خلال يومين من العودة.');
      await employee(client,actor.id,'FOR UPDATE');
      const today=riyadhToday(now);
      const date=type==='expense' ? null : dateFromIntent(intent,now,{allowPast:type==='sick_leave'});
      if(type!=='expense'&&!date) throw new WorkflowError(type==='sick_leave' ? 'المرضية لا تحتاج إذناً مسبقاً. حدد تاريخ العودة منها؛ التقرير الطبي مطلوب خلال يومين من العودة.' : 'حدد تاريخ الطلب بصيغة YYYY-MM-DD أو يوم واضح.');
      if(type==='annual_leave'&&businessDaysBetween(today,date)<5) throw new WorkflowError('طلب الإجازة الاعتيادية يجب تقديمه قبل 5 أيام عمل على الأقل. لم يُرسل الطلب للمشرف.',false,true);
      if(type==='remote_work') {
        if(intent.duration_days && intent.duration_days!==1) throw new WorkflowError('العمل عن بُعد مسموح يوم واحد في الأسبوع بموافقة المشرف.',false,true);
        if(workingHoursError(`${date}T09:00:00+03:00`)) throw new WorkflowError('حدد يوم عمل للعمل عن بُعد.',false,true);
        const from=weekStart(date),to=addCalendarDays(from,7);
        const approved=(await client.query("SELECT id FROM employee_requests WHERE employee_id=$1 AND request_type='remote_work' AND status='approved' AND request_date >= $2 AND request_date < $3",[actor.id,from,to])).rows;
        if(approved.length) throw new WorkflowError('يوجد يوم عمل عن بُعد معتمد لك في هذا الأسبوع بالفعل.',false,true);
      }
      const amount=type==='expense' ? intent.amount : null;
      if(type==='expense'&&(!Number.isFinite(amount)||amount<=0||amount>999999999999||Math.abs(amount*100-Math.round(amount*100))>0.00001||intent.currency!=='SAR')) throw new WorkflowError('حدد مبلغ المصروفات بالريال السعودي، برقم موجب لا يزيد عن منزلتين عشريتين.');
      const assigned=await approver(client,actor,type,amount);
      const reviewer=type==='sick_leave' ? null : assigned;
      const monitor=type==='sick_leave' ? assigned : null;
      const deadline=type==='sick_leave' ? addCalendarDays(date,2) : null;
      const row=(await client.query(`INSERT INTO employee_requests (employee_id,approver_id,request_type,request_date,amount,description,status,report_deadline,created_at,monitor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[actor.id,reviewer?.id??null,type,date,amount,intent.description||'',type==='sick_leave'?'awaiting_report':'pending',deadline,now,monitor?.id??null])).rows[0];
      await audit(client,actor.id,'create_request',{request_id:row.id,type,approver_id:reviewer?.id??null,monitor_id:monitor?.id??null});
      const request=publicRequest(row,now);
      return {action:'create_request',request,reply:type==='sick_leave'
        ? `تم تسجيل العودة من الإجازة المرضية #${row.id}، بدون طلب موافقة مسبقة. المشرف ${monitor.name} يتابع وصول التقرير، ومهلته حتى نهاية ${deadline}. أرفق مستند التقرير مع تعليق «تقرير الطلب ${row.id}».${request.status==='report_overdue'?' التقرير متأخر؛ السياسة لا تحدد عقوبة.':''}`
        : `تم تقديم طلب ${names[type]} #${row.id} إلى صندوق طلبات ${reviewer.name}. الطلب بانتظار موافقته، ولم يُعتمد بعد.`};
    }
    if(intent.action==='decide_request') {
      const row=(await client.query('SELECT * FROM employee_requests WHERE id=$1 FOR UPDATE',[intent.record_id])).rows[0];
      if(!row||row.approver_id!==actor.id) throw new WorkflowError('لا تملك صلاحية اعتماد أو رفض هذا الطلب.',true);
      if(row.status!=='pending') throw new WorkflowError('هذا الطلب اتخذ قراراً بالفعل.',false,true);
      if(!['approved','rejected'].includes(intent.status)) throw new WorkflowError('حدد الموافقة أو الرفض ورقم الطلب.');
      const requester=await employee(client,row.employee_id,'FOR UPDATE');
      const reviewer=await approver(client,requester,row.request_type,Number(row.amount));
      if(reviewer.id!==actor.id) throw new WorkflowError('المعتمد الحالي لهذا الطلب تغير. تواصل مع المسؤول.',true);
      if(intent.status==='approved'&&row.request_type==='annual_leave'&&businessDaysBetween(riyadhToday(row.created_at),dateOnly(row.request_date))<5) throw new WorkflowError('طلب الإجازة لا يستوفي مهلة 5 أيام عمل.',false,true);
      if(intent.status==='approved'&&row.request_type==='remote_work') {
        const from=weekStart(dateOnly(row.request_date)),to=addCalendarDays(from,7);
        const approved=(await client.query("SELECT id FROM employee_requests WHERE employee_id=$1 AND request_type='remote_work' AND status='approved' AND request_date >= $2 AND request_date < $3",[requester.id,from,to])).rows;
        if(approved.length) throw new WorkflowError('لا يمكن اعتماد يوم ثانٍ للعمل عن بُعد في نفس الأسبوع.',false,true);
      }
      const updated=(await client.query('UPDATE employee_requests SET status=$1,decided_at=$2 WHERE id=$3 RETURNING *',[intent.status,now,row.id])).rows[0];
      await audit(client,actor.id,'decide_request',{request_id:row.id,status:intent.status});
      return {action:'decide_request',request:publicRequest(updated,now),reply:`الطلب #${row.id} أصبح ${statuses[intent.status]}.`};
    }
    if(intent.action==='submit_report') {
      const row=(await client.query('SELECT * FROM employee_requests WHERE id=$1 FOR UPDATE',[intent.record_id])).rows[0];
      if(!row||row.employee_id!==actor.id||row.request_type!=='sick_leave') throw new WorkflowError('لا تملك صلاحية إرفاق تقرير لهذا الطلب.',true);
      if(!document?.file_id||typeof document.file_id!=='string'||document.file_id.length>1024||!['application/pdf','image/jpeg','image/png'].includes(document.mime_type)||!Number.isSafeInteger(document.file_size)||document.file_size<1||document.file_size>10*1024*1024) throw new WorkflowError('أرفق ملف PDF أو صورة التقرير (حتى 10 ميجابايت) مع رقم الطلب. الرسالة وحدها لا تُعتبر تقريراً.');
      if(row.report_received_at) throw new WorkflowError('تم تسجيل وصول التقرير لهذا الطلب بالفعل.',false,true);
      const late=riyadhToday(now)>dateOnly(row.report_deadline);
      const updated=(await client.query('UPDATE employee_requests SET report_file_id=$1,report_received_at=$2,status=$3 WHERE id=$4 RETURNING *',[document.file_id,now,late?'report_received_late':'report_received',row.id])).rows[0];
      await audit(client,actor.id,'submit_report',{request_id:row.id,late});
      return {action:'submit_report',request:publicRequest(updated,now),reply:`تم تسجيل وصول التقرير للطلب #${row.id}.${late?' وصل بعد المهلة؛ السياسة لا تحدد عقوبة.':''} استلام الملف لا يعني التحقق من صحة محتواه الطبي.`};
    }
    if(intent.action==='update_task') {
      const row=(await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[intent.record_id])).rows[0];
      const target=row ? await employee(client,row.assignee_id) : null;
      if(!row||!canAccess(actor,target)) throw new WorkflowError('لا تملك صلاحية تحديث هذه المهمة.',true);
      const error=workingHoursError(now);
      if(error) throw new WorkflowError('لا يمكن تحديث حالة المهمة خارج الدوام. '+error,false,true);
      if(riyadhToday(row.due_at)!==riyadhToday(now)) throw new WorkflowError('تحديث حالة المهمة يجب أن يكون خلال يوم المهمة قبل نهاية الدوام.',false,true);
      if(!['pending','in_progress','completed'].includes(intent.status)) throw new WorkflowError('حدد الحالة: معلقة، قيد التنفيذ، أو مكتملة.');
      const task=(await client.query('UPDATE tasks SET status=$1,updated_at=$2 WHERE id=$3 RETURNING *',[intent.status,now,row.id])).rows[0];
      await audit(client,actor.id,'update_task',{task_id:row.id,status:intent.status,updated_at:now.toISOString()});
      return {action:'update_task',task,reply:`تم تحديث حالة المهمة #${row.id} إلى ${{pending:'معلقة',in_progress:'قيد التنفيذ',completed:'مكتملة'}[intent.status]}.`};
    }
    throw new WorkflowError('العملية غير مدعومة.',false,true);
  });
}
