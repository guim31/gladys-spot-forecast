// -----------------------------------------------------------------------------
// Scene action (manifest `scene_actions`, Gladys 5.1+): find the cheapest run
// of N consecutive forecast hours within the next H hours.
//
// "The car needs 4 hours of charging some time in the next two days: when is
// it cheapest?" The scene calls the action, then reads the outputs:
// `starts_now` to start right away, `start_date` and `start_time` for a
// message, `minutes_to_start` for a wait.
//
// The window may begin in the hour in progress only during its first minutes
// (STARTED_GRACE_MS): a window that began at 14:00 is no longer whole at
// 14:40. When the forecast ends before the horizon, the known hours are
// searched.
// -----------------------------------------------------------------------------

import { cheapestWindow, roundPrice } from './prices.js';
import { clockTime, localDay } from './time.js';

export const SCENE_ACTION = { CHEAPEST_WINDOW: 'find_cheapest_window' };

export const ACTION_HOURS = ['1', '2', '3', '4', '5', '6', '8'];
export const ACTION_WITHIN = ['6', '12', '24', '48', '72', '168'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const STARTED_GRACE_MS = 10 * MINUTE;

/** The outputs when no window fits: every key, so a scene can test `found`. */
const NOT_FOUND = {
  found: false,
  starts_now: false,
  start_date: '',
  start_time: '',
  end_time: '',
  average_price: 0,
  minutes_to_start: 0,
};

/**
 * @param {ReturnType<ReturnType<import('./forecast.js').createForecast>['snapshot']>} snapshot
 * @param {{ hours?: unknown, within?: unknown }} fields as sent by the core
 * @returns {object | { invalid: string }} the outputs, or the field that is wrong
 */
export function findCheapestWindow(snapshot, fields) {
  const hours = String(fields?.hours);
  if (!ACTION_HOURS.includes(hours)) {
    return { invalid: 'hours' };
  }
  const within = String(fields?.within);
  if (!ACTION_WITHIN.includes(within)) {
    return { invalid: 'within' };
  }
  const at = snapshot.at.getTime();
  const deadline = at + Number(within) * HOUR;
  const candidates = snapshot.slots.filter(
    (slot) =>
      slot.start.getTime() >= at - STARTED_GRACE_MS &&
      slot.end.getTime() > at &&
      slot.end.getTime() <= deadline,
  );
  const window = cheapestWindow(candidates, Number(hours));
  if (!window) {
    return { ...NOT_FOUND };
  }
  const wait = Math.max(0, window.start.getTime() - at);
  return {
    found: true,
    starts_now: wait === 0,
    start_date: localDay(window.start, snapshot.timeZone),
    start_time: clockTime(window.start, snapshot.timeZone),
    end_time: clockTime(window.end, snapshot.timeZone),
    average_price: roundPrice(window.average),
    minutes_to_start: Math.ceil(wait / MINUTE),
  };
}
