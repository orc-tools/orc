// Local-time date helpers shared by the calendar's view, editor and drag.
export const pad = n => String(n).padStart(2, '0');
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const sameDay = (a, b) => dayKey(a) === dayKey(b);
export const minutesOf = d => d.getHours() * 60 + d.getMinutes();
// Rounded so a day that gains or loses an hour to daylight saving still counts as one.
export const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
export const fmt = options => new Intl.DateTimeFormat(undefined, options);
export const timeFmt = fmt({ hour: '2-digit', minute: '2-digit' });
export const longDayFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });

export function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export const timeValue = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A day and an HH:MM wall time as one local instant, or null.
export function atTime(day, time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  return day && match ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(match[1]), Number(match[2])) : null;
}

export function timeRange(start, end) {
  return `${timeFmt.format(start)} – ${timeFmt.format(end)}`;
}

export function localZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(zone) ? zone : '';
  } catch {
    return '';
  }
}
