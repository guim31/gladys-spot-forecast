// -----------------------------------------------------------------------------
// One device per price zone: the forecast spot prices of that zone.
//
// Its external id is built on the zone ("fi"), the only identity a forecast
// has. Feature keys are forever, like the ids built on them.
//
// Every feature is a read-only sensor. Prices use `currency/decimal` in euros
// (Gladys has no €/kWh unit: the name carries it); the times are `text/text`
// ("Tue 03:00", clock of the zone), the weekday telling which day of the week
// ahead.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { DEVICE_NAMES, NAMES } from './i18n.js';
import { roundPrice } from './prices.js';
import { dayMonthTime, weekdayTime } from './time.js';

const DEVICE_TYPE = 'spot-forecast';

export const FEATURE = {
  PRICE_NOW: 'price_now',
  PRICE_AVG_24H: 'price_avg_24h',
  PRICE_MIN_24H: 'price_min_24h',
  PRICE_MAX_24H: 'price_max_24h',
  PRICE_AVG_7D: 'price_avg_7d',
  PRICE_MIN_7D: 'price_min_7d',
  PRICE_MAX_7D: 'price_max_7d',
  CHEAPEST_WINDOW_START: 'cheapest_window_start',
  CHEAPEST_WINDOW_PRICE: 'cheapest_window_price',
  FORECAST_UPDATED: 'forecast_updated',
  FORECAST_UNTIL: 'forecast_until',
};

// Display bounds only (the core never applies them), symmetric for the gauge:
// Nordic prices go below zero on windy nights.
const PRICE_BOUNDS = { min: -1, max: 1 };
// text/text: min and max are NOT NULL in the core (422 on "Add to Gladys").
const TEXT_BOUNDS = { min: 0, max: 0 };

/**
 * @param {object} gladys
 * @param {string} zone
 */
export function deviceIds(gladys, zone) {
  return gladys.externalIds(DEVICE_TYPE, zone);
}

/**
 * @param {object} gladys
 * @param {string} zone
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
export function buildDevice(gladys, zone, config) {
  const ids = deviceIds(gladys, zone);
  const names = NAMES[config.language];
  const sensor = (key, category, type, bounds, extra = {}) => ({
    name: names[key],
    external_id: ids.feature(key),
    category,
    type,
    ...bounds,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...extra,
  });
  const price = (key) =>
    sensor(
      key,
      DEVICE_FEATURE_CATEGORIES.CURRENCY,
      DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
      PRICE_BOUNDS,
      { unit: DEVICE_FEATURE_UNITS.EURO },
    );
  const text = (key) =>
    sensor(key, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, TEXT_BOUNDS, {
      keep_history: false,
    });

  return {
    name: DEVICE_NAMES[config.language][zone],
    external_id: ids.device,
    model: 'nordpool-predict-fi',
    // Polled once a minute by the core when it does (Gladys#3198: often not):
    // the container's own timer does the work, onPoll is the fallback.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    features: [
      price(FEATURE.PRICE_NOW),
      price(FEATURE.PRICE_AVG_24H),
      price(FEATURE.PRICE_MIN_24H),
      price(FEATURE.PRICE_MAX_24H),
      price(FEATURE.PRICE_AVG_7D),
      price(FEATURE.PRICE_MIN_7D),
      price(FEATURE.PRICE_MAX_7D),
      text(FEATURE.CHEAPEST_WINDOW_START),
      price(FEATURE.CHEAPEST_WINDOW_PRICE),
      text(FEATURE.FORECAST_UPDATED),
      text(FEATURE.FORECAST_UNTIL),
    ],
  };
}

/**
 * The states of a device for a snapshot. A value the snapshot does not know
 * is left out: the feature keeps its last state rather than a made-up one.
 * @param {object} gladys
 * @param {ReturnType<ReturnType<import('./forecast.js').createForecast>['snapshot']>} snapshot
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
export function buildStates(gladys, snapshot, config) {
  const ids = deviceIds(gladys, snapshot.zone);
  const { language } = config;
  const { timeZone } = snapshot;
  const states = [];
  const number = (key, value) =>
    states.push({ device_feature_external_id: ids.feature(key), state: roundPrice(value) });
  const text = (key, value) =>
    states.push({ device_feature_external_id: ids.feature(key), text: value });

  if (snapshot.current) {
    number(FEATURE.PRICE_NOW, snapshot.current.price);
  }
  for (const [summary, avg, min, max] of [
    [snapshot.next24h, FEATURE.PRICE_AVG_24H, FEATURE.PRICE_MIN_24H, FEATURE.PRICE_MAX_24H],
    [snapshot.next7d, FEATURE.PRICE_AVG_7D, FEATURE.PRICE_MIN_7D, FEATURE.PRICE_MAX_7D],
  ]) {
    if (summary) {
      number(avg, summary.average);
      number(min, summary.min.price);
      number(max, summary.max.price);
    }
  }
  if (snapshot.window) {
    text(FEATURE.CHEAPEST_WINDOW_START, weekdayTime(snapshot.window.start, timeZone, language));
    number(FEATURE.CHEAPEST_WINDOW_PRICE, snapshot.window.average);
  }
  if (snapshot.updatedAt) {
    text(FEATURE.FORECAST_UPDATED, dayMonthTime(snapshot.updatedAt, timeZone, language));
  }
  if (snapshot.lastEnd) {
    text(FEATURE.FORECAST_UNTIL, dayMonthTime(snapshot.lastEnd, timeZone, language));
  }
  return states;
}
