// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with unknown values.
// -----------------------------------------------------------------------------

/** The languages every text carries, in this order. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The choices of the cheapest window shown by the device (select values). */
export const WINDOW_HOURS = ['1', '2', '3', '4', '5', '6', '8'];
export const WINDOW_HORIZONS = ['12', '24', '48', '72', '168'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Language of the feature names and of the texts the container writes
  // (a device integration is not told the user's language).
  language: 'fr',
  // The cheapest window the device shows: this many consecutive hours...
  window_hours: '3',
  // ...searched in the next hours.
  window_horizon: '24',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pick = (key, allowed) =>
    allowed.includes(String(raw[key])) ? String(raw[key]) : DEFAULT_CONFIG[key];
  return {
    language: pick('language', LANGUAGES),
    windowHours: Number(pick('window_hours', WINDOW_HOURS)),
    windowHorizon: Number(pick('window_horizon', WINDOW_HORIZONS)),
  };
}
