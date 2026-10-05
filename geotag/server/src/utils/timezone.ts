import { UserError } from './errors';

export const TIME_ZONE = 'Asia/Kolkata';
export const TIME_ZONE_LABEL = 'GMT+05:30';

export interface Stamp {
  date: string; // DD/MM/YYYY
  time: string; // hh:mm AM/PM
  timezone: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

function to12Hour(hour: number, minute: number): string {
  return `${pad(hour % 12 === 0 ? 12 : hour % 12)}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Date and time for the strip, in Indian time. Uses the current time unless a date
 * (YYYY-MM-DD or DD/MM/YYYY) and/or time (HH:MM, 24-hour) was sent.
 */
export function makeStamp(dateInput?: string, timeInput?: string, now = new Date()): Stamp {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  let date = `${parts.day}/${parts.month}/${parts.year}`;
  let time = to12Hour(Number(parts.hour), Number(parts.minute));

  if (dateInput?.trim()) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.trim());
    const indian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(dateInput.trim());
    const [year, month, day] = iso ? [+iso[1], +iso[2], +iso[3]] : indian ? [+indian[3], +indian[2], +indian[1]] : [0, 0, 0];
    const real = new Date(Date.UTC(year, month - 1, day));
    if (!year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) {
      throw new UserError('invalid_date', 'That date is not valid. Please pick the date again.');
    }
    date = `${pad(day)}/${pad(month)}/${year}`;
  }
  if (timeInput?.trim()) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(timeInput.trim());
    if (!match || +match[1] > 23 || +match[2] > 59) {
      throw new UserError('invalid_time', 'That time is not valid. Please pick the time again.');
    }
    time = to12Hour(+match[1], +match[2]);
  }
  return { date, time, timezone: TIME_ZONE_LABEL };
}
