import { alarmTime, isStale, isValidTime, nextOccurrence } from '../src/schedule';

describe('schedule', () => {
  test('later today', () => {
    const now = new Date(2026, 9, 16, 6, 0);
    expect(new Date(nextOccurrence('07:45', now))).toEqual(new Date(2026, 9, 16, 7, 45));
  });
  test('already passed today → tomorrow', () => {
    const now = new Date(2026, 9, 16, 7, 45);
    expect(new Date(nextOccurrence('07:45', now))).toEqual(new Date(2026, 9, 17, 7, 45));
  });
  test('stale after an hour', () => {
    expect(isStale(0, 59 * 60_000)).toBe(false);
    expect(isStale(0, 61 * 60_000)).toBe(true);
  });
  test('time format', () => {
    expect(isValidTime('07:45')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:45')).toBe(false);
  });
  test('keeps the wall-clock time across a daylight-saving change', () => {
    // US clocks go back on 1 Nov 2026 and forward on 14 Mar 2027.
    for (const [y, m, d] of [[2026, 9, 31], [2027, 2, 13]]) {
      const next = new Date(nextOccurrence('07:45', new Date(y, m, d, 7, 45)));
      expect(next).toEqual(new Date(y, m, d + 1, 7, 45));
      // A fixed 24-hour repeat would land an hour off.
      expect(next.getTime() - new Date(y, m, d, 7, 45).getTime()).not.toBe(24 * 3600_000);
    }
  });
  test('alarm names', () => {
    expect(alarmTime('run@07:45')).toBe('07:45');
    expect(alarmTime('linkedin-followup')).toBeNull();
  });
});
