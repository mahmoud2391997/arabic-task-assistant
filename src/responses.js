const types=new Set(['execution','rejection','postpone','inquiry','exception']);
export function classifyResponse(result={}) {
  const action_type=types.has(result.action_type) ? result.action_type : result.action==='reject'||result.error ? 'rejection'
    : result.action==='error' ? 'exception'
    : result.action==='clarify'||(result.action==='policy_answer'&&!result.policy_ids?.length) ? 'inquiry'
    : result.rescheduled ? 'postpone' : 'execution';
  const action=result.request_action || (['reject','clarify','error'].includes(result.action) ? 'unknown' : result.action) || 'unknown';
  const message=result.message || result.reply || result.error || (result.status==='ok'?'Service ready.':'Request processed.');
  const response_type={execution:'execution',rejection:'rejection',postpone:'execution_rescheduled',inquiry:'clarification',exception:'clarification'}[action_type];
  return {...result,action,action_type,message,reply:message,response_type};
}
export function presentReply(reply) {return reply;}

export function notificationText(rows) {
  return rows.length?'إشعاراتك الجديدة:\n'+rows.map(n=>`${n.actor_role==='manager'?'المدير':'المشرف'} ${n.actor_name} أسند لك مهمة #${n.task_id}: ${n.description}`).join('\n')+'\n\n':'';
}
export function withNotifications(result,notifications) {
  const normalized=classifyResponse(result);
  const message=notificationText(notifications)+normalized.message;
  return {...normalized,message,reply:message,notifications};
}

export function apiResponse(result) {
  const normalized=classifyResponse(result);
  // `reply` mirrors `message`: the assessment brief's R1 contract specifies `reply`.
  const response={action:normalized.action,action_type:normalized.action_type,message:normalized.message,reply:normalized.message};
  for(const key of ['task_id','task','tasks','request','requests','entries','policy_ids','rescheduled','data','url','expires_in_seconds','status','ok']) {
    if(normalized[key]!==undefined) response[key]=normalized[key];
  }
  if(normalized.notifications?.length) response.notifications=normalized.notifications;
  return response;
}
