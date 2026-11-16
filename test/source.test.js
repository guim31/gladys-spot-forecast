// -----------------------------------------------------------------------------
// The source: the real nordpool-predict-fi file, its ETag, its failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchForecast, fetchUpdatedAt, parseForecast, SourceError } from '../src/source.js';
import { AT, createFakeSource, FIXTURES } from './helpers/world.js';

const now = new Date(AT).getTime();

test('the real file becomes 218 hourly slots in €/kWh', async () => {
  const source = createFakeSource();
  const result = await fetchForecast('fi', { fetch: source.fetch, now });
  assert.equal(result.notModified, false);
  assert.equal(result.slots.length, 218);
  const [first] = result.slots;
  assert.equal(first.start.toISOString(), '2026-11-14T22:00:00.000Z');
  assert.equal(first.end.toISOString(), '2026-11-14T23:00:00.000Z');
  // 1.7535... euro cents with VAT.
  assert.ok(Math.abs(first.price - 0.017535157203674316) < 1e-12);
  assert.equal(result.slots.at(-1).start.toISOString(), '2026-11-23T23:00:00.000Z');
  assert.ok(result.etag);
  const { headers } = source.requests[0];
  assert.match(headers['User-Agent'], /gladys-spot-forecast/);
});

test('an unchanged file is a 304: no body read, nothing changed', async () => {
  const source = createFakeSource();
  const { etag } = await fetchForecast('fi', { fetch: source.fetch, now });
  const again = await fetchForecast('fi', { fetch: source.fetch, now, etag });
  assert.deepEqual(again, { notModified: true });
  assert.equal(source.requests[1].headers['If-None-Match'], etag);
});

test('broken pairs are skipped, an empty or foreign body is an error', () => {
  const slots = parseForecast(
    [
      [1794693600000.0, 1.5],
      [1794697200000.0, null],
      ['x', 2],
      [1794697201000, 2],
      [1794700800000.0, -0.25],
      [1794693600000.0, 1.5],
    ],
    100,
    1794693600000,
  );
  assert.deepEqual(
    slots.map((slot) => slot.price),
    [0.015, -0.0025],
  );
  assert.throws(() => parseForecast([], 100, now), SourceError);
  assert.throws(() => parseForecast({ error: 'x' }, 100, now), /not a list/);
  // A file from another age is not a forecast.
  assert.throws(() => parseForecast([[0, 1]], 100, now), /empty/);
});

test('HTTP errors, non-JSON and network failures say why, without the URL', async () => {
  const source = createFakeSource();
  source.status = 404;
  await assert.rejects(fetchForecast('fi', { fetch: source.fetch, now }), /HTTP 404/);
  source.status = 200;
  source.body = '<html>rate limited</html>';
  await assert.rejects(fetchForecast('fi', { fetch: source.fetch, now }), /not JSON/);
  source.down = true;
  await assert.rejects(fetchForecast('fi', { fetch: source.fetch, now }), (err) => {
    assert.ok(err instanceof SourceError);
    assert.equal(err.message, 'forecast unreachable (ENOTFOUND)');
    return true;
  });
});

test('the forecast date comes from the last commit, null when GitHub refuses', async () => {
  const source = createFakeSource();
  const date = await fetchUpdatedAt('fi', { fetch: source.fetch });
  assert.equal(date.toISOString(), FIXTURES.commits[0].commit.committer.date.replace('Z', '.000Z'));
  source.apiDown = true;
  assert.equal(await fetchUpdatedAt('fi', { fetch: source.fetch }), null);
  source.down = true;
  assert.equal(await fetchUpdatedAt('fi', { fetch: source.fetch }), null);
});
