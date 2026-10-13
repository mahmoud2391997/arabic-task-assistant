export function classifyResponse(result) {
  const response_type=result.action==='reject' ? 'rejection'
    : ['clarify','error'].includes(result.action) || (result.action==='policy_answer'&&!result.policy_ids?.length) ? 'clarification'
    : result.rescheduled ? 'execution_rescheduled' : 'execution';
  return {...result,response_type};
}
export function presentReply(reply,type) {
  const headings={execution:'تنفيذ',rejection:'رفض',execution_rescheduled:'تنفيذ مع ترحيل',clarification:'توضيح / اعتذار'};
  return `${headings[type] || headings.clarification}\n${reply}`;
}
