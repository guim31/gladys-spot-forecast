// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): the price forecast of
// the days ahead.
//
// Inline values, not device-bound tiles: the widget works before the device is
// added, and an inline tile shows "€/kWh" where a device tile could only say
// "€". Layout, within the core budget (8 components, 2 texts):
//   caption   what the price is (Nord Pool FI forecast, VAT included)
//   tiles     now, average of the next 24 h and 7 days        (show_tiles)
//   chart     the next 2, 4 or 7 days (step line: a price holds for the
//             hour), lowest and highest marked, "now" drawn by the core
//   status    the cheapest window, when the forecast was updated, how far it
//             goes                                            (show_status)
// -----------------------------------------------------------------------------

import { WIDGET_CHART_TYPES, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from './config.js';
import { fill, pick, TEXT } from './i18n.js';
import { summarize } from './prices.js';
import { dayMonthTime, weekdayTime } from './time.js';

export const WIDGET = { FORECAST: 'forecast' };
export const WIDGET_DAYS = ['2', '4', '7'];
export const WIDGET_DEFAULTS = { days: '7', show_tiles: true, show_status: true };

const HOUR = 60 * 60 * 1000;
// A tenth of a cent hides the Nordic nights: 4 decimals. `+ 0` turns -0 into 0.
const round4 = (value) => Math.round(value * 10000) / 10000 + 0;

/**
 * @param {number} value
 * @param {string} language
 */
export function formatPrice(value, language) {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
    signDisplay: 'negative',
  }).format(value);
}

/**
 * Seconds until the next hour starts (the current price changes), within
 * the core bounds.
 * @param {Date} at
 */
function ttlSeconds(at) {
  const toNextHour = 3600 - Math.floor((at.getTime() % HOUR) / 1000);
  return Math.min(3600, Math.max(10, toNextHour + 5));
}

/**
 * @param {object} options
 * @param {ReturnType<ReturnType<import('./forecast.js').createForecast>['snapshot']>} options.snapshot
 * @param {string} options.language the user's language, sent by the core
 * @param {Record<string, unknown>} [options.settings] the widget's settings
 */
export function buildForecastContent({ snapshot, language: raw, settings = {} }) {
  const language = LANGUAGES.includes(raw) ? raw : 'en';
  const t = (text) => pick(text, language);
  const days = WIDGET_DAYS.includes(String(settings.days))
    ? Number(settings.days)
    : Number(WIDGET_DEFAULTS.days);
  const showTiles = settings.show_tiles ?? WIDGET_DEFAULTS.show_tiles;
  const showStatus = settings.show_status ?? WIDGET_DEFAULTS.show_status;
  const { timeZone } = snapshot;

  const hourStart = Math.floor(snapshot.at.getTime() / HOUR) * HOUR;
  const shown = snapshot.upcoming.filter(
    (slot) => slot.start.getTime() < hourStart + days * 24 * HOUR,
  );
  if (shown.length === 0) {
    const text = snapshot.slots.length > 0 ? TEXT.outdated : TEXT.noForecast;
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t(text) }],
    };
  }

  const components = [{ type: 'text', variant: 'caption', text: t(TEXT.caption) }];

  if (showTiles !== false) {
    const tile = (label, price, icon) => {
      if (price !== undefined) {
        components.push({
          type: 'value',
          label: t(label),
          value: round4(price),
          unit: '€/kWh',
          icon,
        });
      }
    };
    tile(TEXT.now, snapshot.current?.price, 'zap');
    tile(TEXT.average24h, snapshot.next24h?.average, 'activity');
    tile(TEXT.average7d, snapshot.next7d?.average, 'calendar');
  }

  const summary = summarize(shown);
  const label = (prefix, slot) => `${t(prefix)} ${weekdayTime(slot.start, timeZone, language)}`;
  components.push({
    type: 'chart',
    chart_type: WIDGET_CHART_TYPES.STEPLINE,
    unit: '€/kWh',
    series: [
      {
        name: t(TEXT.forecast),
        points: shown.map((slot) => ({ t: slot.start.toISOString(), v: round4(slot.price) })),
      },
    ],
    annotations: [
      {
        t: summary.min.start.toISOString(),
        value: round4(summary.min.price),
        label: label(TEXT.min, summary.min),
        color: WIDGET_COLORS.SUCCESS,
      },
      {
        t: summary.max.start.toISOString(),
        value: round4(summary.max.price),
        label: label(TEXT.max, summary.max),
        color: WIDGET_COLORS.DANGER,
      },
    ],
    now_marker: true,
  });

  if (showStatus !== false) {
    const items = [];
    if (snapshot.window) {
      items.push({
        label: t(fill(TEXT.cheapestWindow, { hours: snapshot.windowHours })),
        value:
          `${weekdayTime(snapshot.window.start, timeZone, language)} · ` +
          `${formatPrice(snapshot.window.average, language)} €/kWh`,
        icon: 'trending-down',
        color: WIDGET_COLORS.SUCCESS,
      });
    }
    if (snapshot.updatedAt) {
      items.push({
        label: t(TEXT.updated),
        value: dayMonthTime(snapshot.updatedAt, timeZone, language),
        icon: 'refresh-cw',
        color: snapshot.stale ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
    if (snapshot.lastEnd) {
      items.push({
        label: t(TEXT.until),
        value: dayMonthTime(snapshot.lastEnd, timeZone, language),
        icon: 'calendar',
        color: snapshot.stale ? WIDGET_COLORS.WARNING : WIDGET_COLORS.INFO,
      });
    }
    if (items.length > 0) {
      components.push({ type: 'status', items });
    }
  }

  return { ttl_seconds: ttlSeconds(snapshot.at), components };
}
