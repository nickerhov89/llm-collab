/** Shared browser preview uses the scheduler's exact calendar/DST calculation. */
export interface CalendarSchedule {
  cadence: string;
  time: string;
  timezone: string;
  intervalMinutes?: number;
  weekdays?: number[];
}
export function nextDue(config: CalendarSchedule, after: number): number;
export function validateConfig(raw: unknown): CalendarSchedule;
