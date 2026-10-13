import {classifyResponse} from './responses.js';
import {executeWorkflow,WorkflowError} from './workflows.js';
import { normalize, policy, schedule } from './language.js';
import { canAccess } from './store.js';
import { validateIntent } from './ai.js';

function commandIntent(message) {
  const text=normalize(message).replace(/ة/g,'ه').trim();
  const base={target:'self',assignee_name:'',description:'',date_kind:'unknown',date_value:'',time:'',policy_supported:false,policy_ids:[]};
  const commands={
    'مهامي':{action:'list_tasks'},'كل المهام':{action:'list_tasks',target:'company'},
    'مهام القسم':{action:'list_tasks',target:'department'},'طلباتي':{action:'list_requests'},
    'طلبات للاعتماد':{action:'list_approvals'},'متابعه التقارير':{action:'list_reports'},
    'سياسه الشركه':{action:'policy_question',policy_supported:true,policy_ids:[1,2,3,4,5,6]},
  };
  if(commands[text]) return {...base,...commands[text]};
  const decision=text.match(/^(اعتمد|ارفض) الطلب (?:رقم )?([1-9][0-9]*)$/);
  if(decision) return {...base,action:'decide_request',record_id:Number(decision[2]),status:decision[1]==='اعتمد'?'approved':'rejected'};
  const report=text.match(/^(?:تقرير الطلب|\/report) ([1-9][0-9]*)$/);
  if(report) return {...base,action:'submit_report',record_id:Number(report[1])};
}
const dateTokens = { today:'اليوم', tomorrow:'بكرة', day_after_tomorrow:'بعد بكرة' };
const weekdays = ['الاحد','الاثنين','الثلاثاء','الاربعاء','الخميس','الجمعة','السبت'];
export function createChat({ store, ai, clock = () => new Date() }) {
  const execute = async ({ user_id, message, document, history=[], selectedAction, selectedRequestType }) => {
    const actor = await store.user(user_id);
    if (!actor) return { action:'reject', reply:'المستخدم غير موجود.' };
    const users = await store.users();
    const now = clock();
    const intent = validateIntent(selectedAction ? {action:selectedAction,request_type:selectedRequestType||'',target:'self',assignee_name:'',description:'',date_kind:selectedRequestType==='sick_leave'?'today':'unknown',date_value:'',time:'',policy_supported:false,policy_ids:[]} : commandIntent(message) || await ai({ message, users, now, history }));
    const finish = async result => {
      result.request_action=intent.action==='clarify' ? 'unknown' : intent.action==='policy_question' ? 'policy_answer' : intent.action;
      await store.audit(actor.id, result.action, { reason: result.action === 'reject' ? 'permission_denied' : undefined });
      return result;
    };
    const clarify = reply => finish({ action:'clarify', reply });
    const reject = () => finish({ action:'reject', reply:'لا تملك صلاحية تنفيذ هذا الطلب حسب دورك وقسمك المسجلين.' });
    if (intent.action === 'clarify') return clarify('الطلب غير واضح. اكتب «مهامي» أو «طلباتي»، أو حدد نوع الطلب وتاريخه ورقمه عند الاعتماد أو تحديث الحالة.');
    if (intent.action === 'policy_question') {
      const ids = [...new Set(intent.policy_ids)];
      return finish({ action:'policy_answer', policy_ids: intent.policy_supported ? ids : [],
        reply: intent.policy_supported && ids.length ? ids.map(id => policy[id-1]).join('\n') : 'هذه المعلومة غير متوفرة في نص سياسة الشركة.' });
    }
    if (['create_request','list_requests','list_approvals','list_reports','decide_request','submit_report','update_task'].includes(intent.action)) {
      try {return await executeWorkflow({store,userId:actor.id,intent,now,document});}
      catch(error) {
        if (!(error instanceof WorkflowError)) throw error;
        return finish({action:error.forbidden||error.rejection?'reject':'clarify',reply:error.message});
      }
    }
    let target;
    if (intent.target === 'self') target = actor;
    else if (intent.target === 'person') {
      const matches = users.filter(u => normalize(u.name).replace(/ /g,'') === normalize(intent.assignee_name).replace(/ /g,''));
      if (matches.length !== 1) return clarify('اسم الموظف غير موجود أو غير واضح. حدد اسم موظف مسجل.');
      target = matches[0];
    }
    if (intent.action === 'list_tasks') {
      if (intent.target === 'company' && actor.role !== 'manager') return reject();
      if (intent.target === 'department' && actor.role === 'employee') return reject();
      if (target && !canAccess(actor, target)) return reject();
      const tasks = await store.list(actor.id, target?.id, !target, intent.target === 'department');
      return finish({ action:'list_tasks', tasks, reply: tasks.length ? tasks.map(t => {
        const owner = users.find(u => u.id === t.assignee_id);
        return `#${t.id} ${owner.name}: ${t.description} — ${new Intl.DateTimeFormat('ar-SA', {timeZone:'Asia/Riyadh', dateStyle:'short', timeStyle:'short', calendar:'gregory'}).format(new Date(t.due_at))}`;
      }).join('\n') : 'لا توجد مهام في النطاق المطلوب.' });
    }
    if (!target) return clarify('حدد موظفاً واحداً لإسناد المهمة.');
    if (!canAccess(actor, target)) return reject();
    if (!intent.description.trim()) return clarify('ما وصف المهمة المطلوب تسجيلها؟');
    let date = dateTokens[intent.date_kind];
    if (intent.date_kind === 'weekday') {
      date = normalize(intent.date_value);
      if (!weekdays.includes(date)) return clarify('حدد يوم الأسبوع المطلوب.');
    } else if (intent.date_kind === 'absolute') {
      date = intent.date_value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return clarify('حدد تاريخاً بصيغة YYYY-MM-DD.');
    }
    if (!date) return clarify('متى موعد المهمة؟ حدد اليوم والوقت.');
    if (!/^\d{2}:\d{2}$/.test(intent.time)) return clarify('ما وقت المهمة؟ اكتب الساعة، مثلاً 10 صباحاً.');
    const due = schedule(`${date} ${intent.time}`, now);
    if (due.error) return finish({action:'reject',action_type:'rejection',reply:due.error});
    const task = await store.create(actor.id, target.id, intent.description.trim(), due.dueAt);
    return { action:'create_task', task_id:task.id, task, rescheduled:due.shifted,
      reply:`تم تسجيل المهمة لـ${target.name} بتاريخ ${due.date} الساعة ${due.time}.${due.shifted ? ' وافق الموعد يوم الجمعة، لذا رُحّلت إلى السبت بنفس الوقت.' : ''}` };
  };
  return async input => classifyResponse(await execute(input));
}
