// -----------------------------------------------------------------------------
// Quiet logs: nothing at info for a normal cycle, a repeated failure written
// once (and its recovery once), and nothing secret in them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers/world.js';

/** Capture what the SDK logger writes (console.log / console.error). */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

const MINUTE = 60 * 1000;

test('a day of normal cycles writes nothing at info', async (t) => {
  const world = await createWorld();
  const lines = captureLogs(t);
  for (let i = 0; i < 24 * 60; i += 1) {
    world.clock.advance(MINUTE);
    await world.app.cycle();
  }
  await world.gladys.fake.widgetGet('forecast');
  await world.gladys.fake.poll(world.gladys.fake.discoveredDevices[0]);
  assert.ok(world.source.reads().length >= 48, 'the forecast was read all day');
  assert.ok(world.gladys.fake.sceneEvents.length > 0, 'and the triggers fired');
  assert.deepEqual(lines, []);
});

test('the startup says the forecast answers, once', async (t) => {
  const lines = captureLogs(t);
  await createWorld();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[INFO\] \[spot-forecast\] Forecast fi reachable: 168 hours ahead/);
});

test('an outage is one warning, its end one info line', async (t) => {
  const world = await createWorld();
  const lines = captureLogs(t);
  world.source.down = true;
  for (let i = 0; i < 6 * 60; i += 1) {
    world.clock.advance(MINUTE);
    await world.app.cycle();
  }
  world.source.down = false;
  for (let i = 0; i < 60; i += 1) {
    world.clock.advance(MINUTE);
    await world.app.cycle();
  }
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(
    lines[0],
    /\[WARN\].*Forecast fi read failed \(forecast unreachable \(ENOTFOUND\)\)/,
  );
  assert.match(lines[1], /\[INFO\].*Forecast fi answers again/);
});

test('a user action is one info line', async (t) => {
  const world = await createWorld();
  const lines = captureLogs(t);
  await world.gladys.fake.action('refresh');
  await world.gladys.fake.configUpdated({ language: 'de' });
  await world.gladys.fake.sceneAction('find_cheapest_window', { hours: '2', within: '24' });
  assert.equal(lines.length, 3, lines.join('\n'));
});

test('nothing secret in the logs, even in debug', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await createWorld({ config: { window_hours: '8' } });
  world.source.down = true;
  world.clock.advance(61 * MINUTE);
  await world.app.cycle();
  await world.gladys.fake.action('refresh');
  assert.ok(lines.length > 3);
  const all = lines.join('\n');
  // The integration token the supervisor gives the container.
  assert.doesNotMatch(all, /fake-integration-token/);
  // No request URL either (a public API, but the rule stays: no address).
  assert.doesNotMatch(all, /https?:\/\//);
});
