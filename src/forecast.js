// -----------------------------------------------------------------------------
// The forecast the integration knows for one zone, and when to read it again.
//
// The source is rewritten a few times a day and GitHub caches it 5 minutes:
// a conditional read every 30 minutes (a 304 without body when unchanged)
// sees a new forecast soon enough for hourly scenes. After a failure, again
// after 5, 10, 20, 40 then 60 minutes. The last forecast read stays in use
// while the source is down: it covers a week, an hour without it changes
// nothing to the current hour.
// -----------------------------------------------------------------------------

import { fetchForecast, fetchUpdatedAt, ZONES } from './source.js';
import { cheapestWindow, slotAt, slotsBetween, summarize } from './prices.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const REFRESH_MS = 30 * MINUTE;
const FAILURE_BACKOFF_MS = [5, 10, 20, 40, 60].map((minutes) => minutes * MINUTE);
/** A forecast whose last hour is closer than this is stale (the model stopped). */
export const STALE_AHEAD_MS = 24 * HOUR;

/**
 * @param {object} options
 * @param {string} options.zone a key of ZONES
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export function createForecast({ zone, fetch = globalThis.fetch, now = () => Date.now() }) {
  let slots = [];
  let etag = null;
  let updatedAt = null;
  let lastSuccessAt = null;
  let lastAttemptAt = null;
  let failures = 0;

  return {
    zone,
    timeZone: ZONES[zone].timeZone,

    get lastSuccessAt() {
      return lastSuccessAt;
    },

    /** Why a refresh is due now (for the debug log), or null. */
    dueReason() {
      if (lastAttemptAt === null) {
        return 'first read';
      }
      const elapsed = now() - lastAttemptAt;
      if (failures > 0) {
        const wait = FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length) - 1];
        return elapsed >= wait ? `retry after ${failures} failure(s)` : null;
      }
      return elapsed >= REFRESH_MS ? 'periodic' : null;
    },

    /**
     * Read the source. Throws a SourceError, the forecast in memory kept.
     * @returns {Promise<{ changed: boolean }>}
     */
    async refresh() {
      lastAttemptAt = now();
      try {
        const result = await fetchForecast(zone, { fetch, now: now(), etag });
        lastSuccessAt = now();
        failures = 0;
        if (result.notModified) {
          return { changed: false };
        }
        const changed =
          result.slots.length !== slots.length ||
          result.slots.some(
            (slot, index) =>
              slot.start.getTime() !== slots[index].start.getTime() ||
              slot.price !== slots[index].price,
          );
        slots = result.slots;
        etag = result.etag;
        if (changed || updatedAt === null) {
          updatedAt = (await fetchUpdatedAt(zone, { fetch })) ?? new Date(now());
        }
        return { changed };
      } catch (err) {
        failures += 1;
        throw err;
      }
    },

    /**
     * Everything the device, the widget and the scenes read, at one instant.
     * @param {{ windowHours: number, windowHorizon: number }} config
     */
    snapshot({ windowHours, windowHorizon }) {
      const at = new Date(now());
      const hourStart = Math.floor(at.getTime() / HOUR) * HOUR;
      const current = slotAt(slots, at);
      const ahead = (hours) => slotsBetween(slots, hourStart, hourStart + hours * HOUR);
      const lastEnd = slots.length > 0 ? slots.at(-1).end.getTime() : null;
      // The window may start in the hour in progress: it is the hour a scene
      // can still catch.
      const window = cheapestWindow(ahead(windowHorizon), windowHours);
      return {
        zone,
        timeZone: ZONES[zone].timeZone,
        at,
        slots,
        current,
        next24h: summarize(ahead(24)),
        next7d: summarize(ahead(7 * 24)),
        upcoming: ahead(7 * 24),
        window,
        windowHours,
        windowHorizon,
        updatedAt,
        lastEnd: lastEnd === null ? null : new Date(lastEnd),
        stale: lastEnd === null || lastEnd - at.getTime() < STALE_AHEAD_MS,
      };
    },
  };
}
