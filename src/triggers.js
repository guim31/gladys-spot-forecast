// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`, Gladys 5.1+).
//
// What the device states cannot say: "it starts NOW".
//
//   cheapest_window_started  the cheapest run of N consecutive hours of the
//                            next H hours begins now: nothing cheaper is
//                            forecast before the horizon. Once it fired, the
//                            same choice stays silent until the horizon it
//                            looked at is over (src/app.js): with falling
//                            prices the cheapest window "starts now" hour
//                            after hour, and a dishwasher must start once a
//                            day, not every hour;
//   price_below_started      the forecast price goes under a threshold: the
//                            first hour of a run under it begins, with the
//                            end of that run.
//
// The core filters scene events on equality and membership only, so the
// scene author picks N, H and the threshold in required selects, and the
// integration fires one event per choice that matches the hour. At most
// 25 events an hour, far from the 300 per minute of the core.
// -----------------------------------------------------------------------------

import { cheapestWindow, roundPrice, slotAfter, slotsBetween } from './prices.js';
import { clockTime } from './time.js';

const HOUR = 60 * 60 * 1000;

export const TRIGGER = {
  CHEAPEST_WINDOW: 'cheapest_window_started',
  PRICE_BELOW: 'price_below_started',
};

/** The values the scene author can pick, as declared in the manifest options. */
export const TRIGGER_HOURS = ['1', '2', '3', '4', '6', '8'];
export const TRIGGER_HORIZONS = ['12', '24', '48'];
export const THRESHOLDS = ['0.00', '0.02', '0.05', '0.08', '0.10', '0.15', '0.20'];

/**
 * The scene events to fire when `slot` begins.
 * @param {Array} slots every known slot, sorted
 * @param {{ start: Date, end: Date, price: number }} slot
 * @param {string} timeZone clock of the times sent
 * @returns {Array<{ key: string, id: string, until: number, data: object }>}
 *   `id` names the choice, `until` the end of what it announced
 */
export function eventsForSlot(slots, slot, timeZone) {
  if (!slots.includes(slot)) {
    return [];
  }
  const time = (date) => clockTime(date, timeZone);
  const start = slot.start.getTime();
  const lastEnd = slots.at(-1).end.getTime();
  const events = [];

  for (const horizon of TRIGGER_HORIZONS) {
    const to = start + Number(horizon) * HOUR;
    // A forecast shorter than the horizon cannot say nothing cheaper comes.
    if (lastEnd < to) {
      continue;
    }
    const candidates = slotsBetween(slots, start, to);
    for (const hours of TRIGGER_HOURS) {
      const window = cheapestWindow(candidates, Number(hours));
      if (window && window.start.getTime() === start) {
        events.push({
          key: TRIGGER.CHEAPEST_WINDOW,
          id: `${TRIGGER.CHEAPEST_WINDOW}:${hours}:${horizon}`,
          until: to,
          data: {
            hours,
            horizon,
            average_price: roundPrice(window.average),
            start_time: time(window.start),
            end_time: time(window.end),
          },
        });
      }
    }
  }

  const before = slots.find((other) => other.end.getTime() === start);
  for (const threshold of THRESHOLDS) {
    const limit = Number(threshold);
    if (slot.price >= limit || (before && before.price < limit)) {
      continue;
    }
    // The run of hours under the threshold, as far as the forecast goes.
    let last = slot;
    let count = 1;
    for (
      let next = slotAfter(slots, last);
      next && next.price < limit;
      next = slotAfter(slots, next)
    ) {
      last = next;
      count += 1;
    }
    events.push({
      key: TRIGGER.PRICE_BELOW,
      id: `${TRIGGER.PRICE_BELOW}:${threshold}`,
      until: last.end.getTime(),
      data: {
        threshold,
        price: roundPrice(slot.price),
        hours: count,
        start_time: time(slot.start),
        end_time: time(last.end),
      },
    });
  }
  return events;
}
