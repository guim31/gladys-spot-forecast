// -----------------------------------------------------------------------------
// The open forecasts, one per price zone.
//
// Finland: nordpool-predict-fi by vividfog (MIT), a machine-learning model
// that predicts the Nord Pool FI day-ahead prices a week ahead from weather
// forecasts, wind power, nuclear availability and more. Its deploy folder on
// GitHub holds `prediction.json`: hourly pairs `[UTC ms, euro cents/kWh,
// VAT included]`, the past day included, rewritten a few times a day.
//
// Read without account or key, with `If-None-Match`: an unchanged file is a
// 304 with no body. When the file changed, one call to the GitHub API gives
// the time of its last commit (the date of the forecast); when it fails (60
// calls an hour per IP without token), the time the container saw the change
// stands in.
//
// No other open forecast without key was found for Sweden or Germany
// (November 2026): ZONES is the place to add one.
// -----------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const TIMEOUT_MS = 20 * 1000;
/** Hours further than this from now are not a forecast (a bad timestamp). */
const MAX_AHEAD_MS = 31 * 24 * HOUR;

export const ZONES = {
  fi: {
    country: 'FI',
    timeZone: 'Europe/Helsinki',
    url: 'https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/prediction.json',
    commitsUrl:
      'https://api.github.com/repos/vividfog/nordpool-predict-fi/commits?path=deploy/prediction.json&per_page=1',
    // The file carries euro cents with VAT: the integration publishes €/kWh.
    divisor: 100,
  },
};

/** A failure, with a short reason for the logs (never the URL). */
export class SourceError extends Error {}

const USER_AGENT = 'gladys-spot-forecast (+https://github.com/guim31/gladys-spot-forecast)';

async function get(fetchImpl, url, headers) {
  try {
    return await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const code = err.cause?.code ?? err.name;
    throw new SourceError(`forecast unreachable (${code})`);
  }
}

/**
 * Turn the body into sorted hourly slots in €/kWh. Pairs that are not two
 * finite numbers are skipped; a body without a single valid pair is an error.
 * @param {unknown} body
 * @param {number} divisor
 * @param {number} now ms
 */
export function parseForecast(body, divisor, now) {
  if (!Array.isArray(body)) {
    throw new SourceError('forecast is not a list');
  }
  const byStart = new Map();
  for (const pair of body) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }
    const [time, value] = pair;
    if (typeof time !== 'number' || typeof value !== 'number') {
      continue;
    }
    if (!Number.isFinite(time) || !Number.isFinite(value) || time % HOUR !== 0) {
      continue;
    }
    if (Math.abs(time - now) > MAX_AHEAD_MS) {
      continue;
    }
    byStart.set(time, value / divisor);
  }
  if (byStart.size === 0) {
    throw new SourceError('forecast is empty');
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, price]) => ({
      start: new Date(start),
      end: new Date(start + HOUR),
      price,
    }));
}

/**
 * @param {string} zone a key of ZONES
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {number} options.now ms
 * @param {string | null} [options.etag] of the last body read
 * @returns {Promise<{ notModified: true } | { notModified: false, slots: Array, etag: string | null }>}
 */
export async function fetchForecast(zone, { fetch: fetchImpl, now, etag = null }) {
  const { url, divisor } = ZONES[zone];
  const response = await get(fetchImpl, url, etag ? { 'If-None-Match': etag } : {});
  if (response.status === 304) {
    return { notModified: true };
  }
  if (!response.ok) {
    throw new SourceError(`forecast answered HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new SourceError('forecast is not JSON');
  }
  return {
    notModified: false,
    slots: parseForecast(body, divisor, now),
    etag: response.headers.get('etag'),
  };
}

/**
 * When the forecast file was last committed, or null when GitHub does not
 * say (rate limit, outage): a best effort.
 * @param {string} zone
 * @param {{ fetch: typeof fetch }} options
 * @returns {Promise<Date | null>}
 */
export async function fetchUpdatedAt(zone, { fetch: fetchImpl }) {
  try {
    const response = await get(fetchImpl, ZONES[zone].commitsUrl, {
      Accept: 'application/vnd.github+json',
    });
    if (!response.ok) {
      return null;
    }
    const [commit] = await response.json();
    const date = new Date(commit?.commit?.committer?.date ?? commit?.commit?.author?.date);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
