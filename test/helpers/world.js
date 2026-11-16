// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake source serving the
// real forecast of 16 November 2026 (nordpool-predict-fi), a settable clock and
// a temporary /data, with the integration wired on top through createApp — the
// very wiring index.js uses.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/source/${name}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  // Read on 16 November 2026, 15:15 (Paris): 218 hours, 14 Nov 22:00 UTC to
  // 23 Nov 23:00 UTC, euro cents with VAT.
  prediction: fixture('prediction-2026-11-16.json'),
  // The GitHub API answer for the last commit of deploy/prediction.json.
  commits: fixture('commits.json'),
};

/** 16 November 2026, 15:30 in Helsinki (EET, UTC+2), after the 13:05 UTC update. */
export const AT = '2026-11-16T13:30:00Z';

/**
 * A fake source: GitHub raw (the forecast, with an ETag) and the GitHub API
 * (the last commit). `source.body` is what the forecast URL serves,
 * `source.status` its status, `source.down` makes every request fail like an
 * unreachable host, `source.apiDown` only the GitHub API.
 */
export function createFakeSource() {
  const source = {
    body: FIXTURES.prediction,
    status: 200,
    down: false,
    apiDown: false,
    requests: [],
    etag() {
      return `"${JSON.stringify(source.body).length}-${JSON.stringify(source.body).slice(-20)}"`;
    },
    async fetch(url, init) {
      const parsed = new URL(url);
      source.requests.push({ url: parsed, headers: init?.headers ?? {} });
      if (source.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      if (parsed.hostname === 'api.github.com') {
        if (source.apiDown) {
          return new Response('{"message":"API rate limit exceeded"}', { status: 403 });
        }
        return Response.json(FIXTURES.commits);
      }
      const etag = source.etag();
      if (source.status === 200 && init?.headers?.['If-None-Match'] === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }
      const text = typeof source.body === 'string' ? source.body : JSON.stringify(source.body);
      return new Response(text, {
        status: source.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ETag: etag },
      });
    },
    /** Requests to the forecast file only. */
    reads() {
      return source.requests.filter((request) => request.url.hostname !== 'api.github.com');
    },
  };
  return source;
}

/** A clock the test moves by hand. */
export function createClock(iso = AT) {
  let current = new Date(iso).getTime();
  return {
    now: () => current,
    set(next) {
      current = new Date(next).getTime();
    },
    advance(ms) {
      current += ms;
    },
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {boolean} [options.created] the user already added the device
 * @param {string} [options.at] the clock, ISO
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 * @param {(source: ReturnType<typeof createFakeSource>) => void} [options.prepare]
 */
export async function createWorld({
  config = {},
  created = true,
  at = AT,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-spot-forecast-')),
  prepare,
} = {}) {
  const source = createFakeSource();
  prepare?.(source);
  const clock = createClock(at);
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, { fetch: source.fetch, now: clock.now, timers: false, dataDir });
  const world = { gladys, source, clock, app, dataDir };
  if (created) {
    // The device as the user added it, before the integration connects.
    const { buildDevice } = await import('../../src/device.js');
    const { normalizeConfig } = await import('../../src/config.js');
    gladys.fake.devices = [buildDevice(gladys, 'fi', normalizeConfig(config))];
  }
  if (connect) {
    await gladys.connect();
  }
  return world;
}

/** External id of a feature of the Finnish device. */
export const featureId = (gladys, key) => gladys.externalIds('spot-forecast', 'fi').feature(key);

/** The last state of a feature: a number, or the text of a text feature. */
export function last(gladys, key) {
  const id = featureId(gladys, key);
  const states = gladys.fake.states.filter((s) => s.device_feature_external_id === id);
  const state = states.at(-1);
  return state === undefined ? undefined : (state.text ?? state.state);
}
