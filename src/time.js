// -----------------------------------------------------------------------------
// The clock of the hours shown to the user.
//
// The forecast is a series of UTC hours. The times the user reads (the start
// of the cheapest window, the scene variables, the widget) are in the time of
// the price zone (Europe/Helsinki for Finland), whatever the timezone of the
// Gladys host: a Finnish price hour is a Finnish clock hour.
// -----------------------------------------------------------------------------

const formatters = new Map();

/**
 * @param {string} locale
 * @param {string} timeZone
 * @param {Intl.DateTimeFormatOptions} options
 */
function formatter(locale, timeZone, options) {
  const key = JSON.stringify([locale, timeZone, options]);
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    formatters.set(key, found);
  }
  return found;
}

/**
 * @param {Date} date
 * @param {string} timeZone
 */
function parts(date, timeZone) {
  const found = {};
  const format = formatter('en-GB', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const { type, value } of format.formatToParts(date)) {
    found[type] = value;
  }
  return found;
}

/**
 * `HH:MM` on the clock of `timeZone`.
 * @param {Date} date
 * @param {string} timeZone
 */
export function clockTime(date, timeZone) {
  const { hour, minute } = parts(date, timeZone);
  return `${hour}:${minute}`;
}

/**
 * `YYYY-MM-DD` on the clock of `timeZone`.
 * @param {Date} date
 * @param {string} timeZone
 */
export function localDay(date, timeZone) {
  const { year, month, day } = parts(date, timeZone);
  return `${year}-${month}-${day}`;
}

/**
 * The short weekday then the time: "Tue 03:00", "mar. 03:00", "Di. 03:00".
 * A forecast reaches a week ahead: the weekday tells which day.
 * @param {Date} date
 * @param {string} timeZone
 * @param {string} language
 */
export function weekdayTime(date, timeZone, language) {
  const weekday = formatter(language, timeZone, { weekday: 'short' }).format(date);
  return `${weekday} ${clockTime(date, timeZone)}`;
}

/**
 * Day, month and time: "16/11 15:05" (the order and separator of the
 * language).
 * @param {Date} date
 * @param {string} timeZone
 * @param {string} language
 */
export function dayMonthTime(date, timeZone, language) {
  const day = formatter(language, timeZone, { day: '2-digit', month: '2-digit' }).format(date);
  return `${day} ${clockTime(date, timeZone)}`;
}
