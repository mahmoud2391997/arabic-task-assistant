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
