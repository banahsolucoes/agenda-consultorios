import { config } from '../config';

export function isWithinBusinessWindow(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');

  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const isWithinHours = hour >= config.workHours.start && hour < config.workHours.end;

  return isWeekday && isWithinHours;
}

export function currentDateKeyInTz(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
}
