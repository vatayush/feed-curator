export const ALARM_PREFIX = 'run@';
export const LINKEDIN_DELAY_MIN = 3;
/** A missed alarm more than this late is skipped rather than run. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/** Next time today or tomorrow that the local clock reads `hhmm` ("07:45"), as epoch ms. */
export function nextOccurrence(hhmm: string, now: Date): number {
  const [h, m] = hhmm.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** The "HH:MM" an alarm named by scheduleRuns stands for, or null for other alarms. */
export function alarmTime(name: string): string | null {
  return name.startsWith(ALARM_PREFIX) ? name.slice(ALARM_PREFIX.length) : null;
}

export function isStale(scheduledTime: number, now: number): boolean {
  return now - scheduledTime > STALE_AFTER_MS;
}

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
