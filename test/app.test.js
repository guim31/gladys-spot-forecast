// -----------------------------------------------------------------------------
// The integration end to end, on the real forecast of 16 November 2026,
// against the SDK's fake Gladys. Expected values computed by hand (Python,
// from the fixture) — not from the code under test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp } from '../src/app.js';
import { normalizeConfig } from '../src/config.js';
import { buildDevice, FEATURE } from '../src/device.js';
import { createFakeSource, createWorld, last } from './helpers/world.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} is not ${expected}`);

test('the device shows the forecast at 15:30 in Helsinki', async () => {
  const { gladys } = await createWorld();
  near(last(gladys, FEATURE.PRICE_NOW), 0.15445);
  near(last(gladys, FEATURE.PRICE_AVG_24H), 0.23409);
  near(last(gladys, FEATURE.PRICE_MIN_24H), 0.14417);
  near(last(gladys, FEATURE.PRICE_MAX_24H), 0.33296);
  near(last(gladys, FEATURE.PRICE_AVG_7D), 0.10019);
  near(last(gladys, FEATURE.PRICE_MIN_7D), 0.01872);
  near(last(gladys, FEATURE.PRICE_MAX_7D), 0.33296);
  // The cheapest 3 hours of the next 24: Tuesday 00:00-03:00 in Helsinki.
  assert.equal(last(gladys, FEATURE.CHEAPEST_WINDOW_START), 'mar. 00:00');
  near(last(gladys, FEATURE.CHEAPEST_WINDOW_PRICE), 0.16756);
  // The commit of 13:05 UTC, the last hour ending 24 Nov 00:00 UTC.
  assert.equal(last(gladys, FEATURE.FORECAST_UPDATED), '16/11 15:05');
  assert.equal(last(gladys, FEATURE.FORECAST_UNTIL), '24/11 02:00');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('the window follows the configuration, the names its language', async () => {
  const { gladys } = await createWorld({
    config: { language: 'en', window_hours: '1', window_horizon: '168' },
  });
  // The cheapest hour of the week: Saturday 21 Nov, 01:00 in Helsinki.
  assert.equal(last(gladys, FEATURE.CHEAPEST_WINDOW_START), 'Sat 01:00');
  near(last(gladys, FEATURE.CHEAPEST_WINDOW_PRICE), 0.01872);
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Spot price forecast Finland');
});

test('the source is read every 30 minutes, with If-None-Match', async () => {
  const world = await createWorld();
  assert.equal(world.source.reads().length, 1);
  for (let i = 0; i < 60; i += 1) {
    world.clock.advance(MINUTE);
    await world.app.cycle();
  }
  const reads = world.source.reads();
  assert.equal(reads.length, 3);
  assert.ok(reads[1].headers['If-None-Match']);
  // An unchanged forecast: the commit date is asked once only.
  assert.equal(world.source.requests.length - reads.length, 1);
});

test('a new forecast is published, and its date asked again', async () => {
  const world = await createWorld();
  world.source.body = world.source.body.map(([time, cents]) => [time, cents + 10]);
  world.clock.advance(31 * MINUTE);
  await world.app.cycle();
  // 14:01 UTC: 17.141 c + 10 c.
  near(last(world.gladys, FEATURE.PRICE_NOW), 0.27141);
  assert.equal(world.source.requests.length - world.source.reads().length, 2);
});

test('the commit date falls back on the time the forecast was seen', async () => {
  const { gladys } = await createWorld({ prepare: (source) => (source.apiDown = true) });
  assert.equal(last(gladys, FEATURE.FORECAST_UPDATED), '16/11 15:30');
});

test('an outage keeps the forecast and says so after 2 hours; the return clears it', async () => {
  const world = await createWorld();
  world.source.down = true;
  world.clock.advance(HOUR);
  await world.app.cycle();
  // A GitHub blip: the forecast covers days, the status stays green.
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  world.clock.advance(HOUR);
  await world.app.cycle();
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /dernière prévision lue/);
  // The forecast in memory still moves with the clock: 17:30 in Helsinki.
  near(last(world.gladys, FEATURE.PRICE_NOW), 0.21822);
  world.source.down = false;
  // The backoff: the next try within the hour.
  world.clock.advance(HOUR);
  await world.app.cycle();
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('a forecast that stopped moving is stale', async () => {
  const world = await createWorld({ at: '2026-11-23T02:00:00Z' });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.en, /no longer updated/);
});

test('an empty answer at startup: no state, a red status, nothing made up', async () => {
  const world = await createWorld({ prepare: (source) => (source.body = []) });
  assert.equal(world.gladys.fake.states.length, 0);
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
});

test('the price goes under 0.05 €/kWh at 00:00 in Helsinki, for 8 hours', async () => {
  const { gladys } = await createWorld({ at: '2026-11-17T22:00:30Z' });
  const below = gladys.fake.sceneEvents.filter((e) => e.key === 'price_below_started');
  assert.deepEqual(
    below.map((e) => e.data.threshold),
    ['0.05'],
  );
  assert.deepEqual(below[0].data, {
    threshold: '0.05',
    price: 0.04224,
    hours: 8,
    start_time: '00:00',
    end_time: '08:00',
  });
});

test('the cheapest window fires once per horizon, not every hour', async () => {
  const world = await createWorld({ at: '2026-11-17T23:00:30Z' });
  const starts = [];
  for (let hour = 0; hour < 60; hour += 1) {
    world.clock.advance(HOUR);
    const before = world.gladys.fake.sceneEvents.length;
    await world.app.cycle();
    for (const event of world.gladys.fake.sceneEvents.slice(before)) {
      if (
        event.key === 'cheapest_window_started' &&
        event.data.hours === '3' &&
        event.data.horizon === '24'
      ) {
        starts.push({ at: world.clock.now(), data: event.data });
      }
    }
  }
  // 18 Nov 00:00 UTC (02:00 Helsinki): the cheapest 3 h of the next 24, by
  // hand (2.28 + 2.40 + 2.43 c / 3). With falling prices it would start
  // "now" again at 03:00, 04:00, 05:00: silent until the 24 hours are over.
  assert.equal(starts[0].data.start_time, '02:00');
  assert.equal(starts[0].data.end_time, '05:00');
  near(starts[0].data.average_price, 0.0237);
  assert.ok(starts.length >= 2);
  for (let i = 1; i < starts.length; i += 1) {
    assert.ok(starts[i].at - starts[i - 1].at >= 24 * HOUR - MINUTE);
  }
});

test('an hour seen late fires nothing, a restart does not fire twice', async () => {
  const late = await createWorld({ at: '2026-11-17T22:30:00Z' });
  assert.equal(late.gladys.fake.sceneEvents.length, 0);

  const first = await createWorld({ at: '2026-11-17T22:00:30Z' });
  const fired = first.gladys.fake.sceneEvents.length;
  assert.ok(fired > 0);
  const again = await createWorld({ at: '2026-11-17T22:02:00Z', dataDir: first.dataDir });
  assert.equal(again.gladys.fake.sceneEvents.length, 0);
});

test('the refresh action: green when read, red with the reason otherwise', async () => {
  const world = await createWorld();
  const ok = await world.gladys.fake.action('refresh');
  assert.equal(ok.success, true);
  // 13:00 UTC on 16 Nov to 00:00 UTC on 24 Nov: 179 hours.
  assert.match(ok.data.message.fr, /179 heures à venir, jusqu'au 24\/11 02:00/);
  world.source.down = true;
  const failed = await world.gladys.fake.action('refresh');
  assert.equal(failed.success, false);
  assert.match(failed.error.fr, /n'a pas pu être lue \(forecast unreachable \(ENOTFOUND\)\)/);
});

test('the scene action finds the cheapest hours, or fails in red', async () => {
  const world = await createWorld();
  const ok = await world.gladys.fake.sceneAction('find_cheapest_window', {
    hours: '3',
    within: '24',
  });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data.outputs, {
    found: true,
    starts_now: false,
    start_date: '2026-11-17',
    start_time: '00:00',
    end_time: '03:00',
    average_price: 0.16756,
    minutes_to_start: 8 * 60 + 30,
  });
  const tooShort = await world.gladys.fake.sceneAction('find_cheapest_window', {
    hours: '8',
    within: '6',
  });
  assert.equal(tooShort.data.outputs.found, false);
  const invalid = await world.gladys.fake.sceneAction('find_cheapest_window', {
    hours: '7',
    within: '24',
  });
  assert.equal(invalid.success, false);
  assert.match(invalid.error.fr, /champ « hours »/);

  const down = await createWorld({ prepare: (source) => (source.down = true) });
  const none = await down.gladys.fake.sceneAction('find_cheapest_window', {
    hours: '2',
    within: '24',
  });
  assert.equal(none.success, false);
  assert.match(none.error.fr, /Aucune prévision/);
});

test('the device just added receives every state again', async () => {
  const world = await createWorld({ created: false });
  assert.equal(world.gladys.fake.states.length, 0);
  const device = world.gladys.fake.discoveredDevices[0];
  world.gladys.fake.devices = [device];
  await world.gladys.fake.deviceCreated(device);
  assert.equal(world.gladys.fake.states.length, device.features.length);
});

test('the widget fits the core budget, in every language and setting', async () => {
  const world = await createWorld();
  for (const language of ['en', 'fr', 'de', 'es', 'it']) {
    for (const settings of [
      {},
      { days: '2', show_tiles: false, show_status: false },
      { days: '4', show_tiles: true },
    ]) {
      const ack = await world.gladys.fake.widgetGet('forecast', { language, settings });
      assert.equal(ack.success, true);
      const content = ack.data.content;
      assert.deepEqual(
        validateWidgetContent(content),
        [],
        `${language} ${JSON.stringify(settings)}`,
      );
      const chart = content.components.find((c) => c.type === 'chart');
      const days = Number(settings.days ?? 7);
      assert.equal(chart.series[0].points.length, days * 24);
      const tiles = content.components.filter((c) => c.type === 'value').length;
      assert.equal(tiles, settings.show_tiles === false ? 0 : 3);
      const status = content.components.some((c) => c.type === 'status');
      assert.equal(status, settings.show_status !== false);
    }
  }
  const empty = await createWorld({ prepare: (source) => (source.down = true) });
  const ack = await empty.gladys.fake.widgetGet('forecast', { language: 'fr' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.match(ack.data.content.components[0].text, /Pas encore de prévision/);
  const old = await createWorld({ at: '2026-11-25T12:00:00Z' });
  const outdated = await old.gladys.fake.widgetGet('forecast', { language: 'en' });
  assert.match(outdated.data.content.components[0].text, /no longer publishes/);
});

test('an action reads the source but fires no scene event', async () => {
  const world = await createWorld({ at: '2026-11-17T21:30:00Z' });
  const before = world.gladys.fake.sceneEvents.length;
  world.clock.set('2026-11-17T22:00:30Z');
  await world.gladys.fake.action('refresh');
  assert.equal(world.gladys.fake.sceneEvents.length, before);
  await world.app.cycle();
  assert.ok(world.gladys.fake.sceneEvents.length > before, 'the next cycle fires them');
});

test('the states refresh on the container timer alone, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-16T13:58:00Z') });
  const source = createFakeSource();
  const gladys = createFakeGladys({});
  gladys.fake.devices = [buildDevice(gladys, 'fi', normalizeConfig())];
  t.mock.method(gladys, 'onPoll', () => {});
  const app = createApp(gladys, {
    fetch: source.fetch,
    dataDir: mkdtempSync(join(tmpdir(), 'gladys-spot-forecast-')),
  });
  await gladys.connect();
  near(last(gladys, FEATURE.PRICE_NOW), 0.15445);
  for (let i = 0; i < 3; i += 1) {
    t.mock.timers.tick(MINUTE);
    for (let j = 0; j < 20; j += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  near(last(gladys, FEATURE.PRICE_NOW), 0.17141);
  assert.equal(gladys.onPoll.mock.callCount(), 1, 'replaced by a mock: the core could not call it');
  app.stop();
});

test("the core's onPoll runs a cycle only when the timer missed one", async () => {
  const world = await createWorld();
  const device = world.gladys.fake.discoveredDevices[0];
  world.clock.advance(MINUTE);
  await world.gladys.fake.poll(device);
  const before = world.source.reads().length;
  world.clock.advance(31 * MINUTE);
  await world.gladys.fake.poll(device);
  assert.equal(world.source.reads().length, before + 1, 'the stalled timer is replaced');
});
