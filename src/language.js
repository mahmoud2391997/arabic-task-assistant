export function normalize(text) {
  return text.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/\s+/g, ' ').trim();
}

export const policy = [
  'الدوام من الأحد إلى الخميس من 8:00 صباحاً حتى 4:00 عصراً، والسبت دوام نصفي حتى 12:00 ظهراً.',
  'طلب الإجازة الاعتيادية قبل 5 أيام عمل على الأقل، ويعتمده المشرف المباشر.',
  'الإجازة المرضية تتطلب تقريراً طبياً خلال يومين من العودة.',
  'العمل عن بُعد يوم واحد في الأسبوع بموافقة المشرف.',
  'المصروفات حتى 500 ريال يعتمدها المشرف، وما فوقها المدير.',
  'تحديث حالة المهمة يومياً قبل نهاية الدوام.',
];

const days = ['الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعة', 'السبت'];
function addDays(date, offset) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function riyadhToday(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function workingHoursError(value) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return 'الموعد غير صحيح.';
  const date = riyadhToday(instant);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Riyadh', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(instant).map(p => [p.type,p.value]));
  const minutes = Number(parts.hour)*60+Number(parts.minute);
  if (day === 5) return 'لا تسجّل مهام يوم الجمعة. حدد موعداً خلال دوام السبت.';
  const closing = day === 6 ? 12*60 : 16*60;
  if (minutes < 8*60 || minutes >= closing) return day === 6
    ? 'الموعد خارج ساعات دوام السبت. اختر وقتاً من 08:00 صباحاً إلى ما قبل 12:00 ظهراً.'
    : 'الموعد خارج ساعات الدوام. اختر وقتاً من 08:00 صباحاً إلى ما قبل 16:00 عصراً من الأحد إلى الخميس.';
}

export function schedule(text, now) {
  text = normalize(text);
  const today = riyadhToday(now);
  let date;
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const weekday = days.findIndex(day => text.includes(day));
  const relativeCount = [ /بعد بكر[ةه]/.test(text), /(?<!بعد )بكر[ةه]/.test(text), /اليوم/.test(text), weekday >= 0, !!explicit ].filter(Boolean).length;
  if (relativeCount > 1) return { error: 'ذكرت أكثر من تاريخ. حدد تاريخاً واحداً للمهمة.' };
  if (explicit) {
    date = explicit[1];
    const d = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== date) return { error: 'التاريخ غير صحيح. اكتب تاريخاً صالحاً.' };
  } else if (/بعد بكر[ةه]/.test(text)) date = addDays(today, 2);
  else if (/بكر[ةه]/.test(text)) date = addDays(today, 1);
  else if (/اليوم/.test(text)) date = today;
  else if (weekday >= 0) {
    const current = new Date(`${today}T12:00:00Z`).getUTCDay();
    const offset = (weekday - current + 7) % 7;
    date = addDays(today, offset || 7);
  }
  if (!date) return { error: 'متى موعد المهمة؟ حدد اليوم والوقت.' };
  let hour, minute = 0;
  const numbers = text.replace(/\d{4}-\d{2}-\d{2}/g, '').match(/(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/g) ?? [];
  if (numbers.length > 1) return { error: 'حدد وقتاً واحداً للمهمة.' };
  // Avoid reading the year of an ISO date as an hour.
  const timeText = text.replace(/\d{4}-\d{2}-\d{2}/g, '');
  const time = timeText.match(/(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?(?=\s|$)/);
  if (time) {
    hour = Number(time[1]); minute = Number(time[2] ?? 0);
    if (hour > 23 || minute > 59) return { error: 'الوقت غير صحيح. استخدم وقتاً مثل 09:00 أو 13:00.' };
    if (/الظهر|العصر|عصرا|مساء|المغرب|الليل/.test(text) && hour >= 1 && hour < 12) hour += 12;
    if (/صباح|الفجر/.test(text) && hour === 12) hour = 0;
  } else if (/العصر|عصرا/.test(text)) hour = 16;
  else if (/الظهر/.test(text)) hour = 12;
  else return { error: 'ما وقت المهمة؟ اكتب الساعة، مثلاً 10 صباحاً.' };
  if (date < today) return { error: 'التاريخ في الماضي. حدد موعداً قادماً.' };
  const originalDate = date;
  const shifted = new Date(`${date}T12:00:00Z`).getUTCDay() === 5;
  if (shifted) date = addDays(date, 1);
  const timeString = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  const dueAt = `${date}T${timeString}:00+03:00`;
  const error = workingHoursError(dueAt);
  if (error) return {error: `${shifted ? 'وافق الموعد يوم الجمعة، وبعد ترحيله إلى السبت: ' : ''}${error}`};
  return { dueAt, shifted, originalDate, date, time: timeString };
}
