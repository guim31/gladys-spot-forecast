// -----------------------------------------------------------------------------
// The integration: registers every SDK handler on a GladysIntegration (or the
// SDK's fake Gladys in the tests) and runs the refresh cycle, so index.js stays
// a few lines and the tests drive the very same wiring.
//
// One cycle, every minute on the container's own timer (the core's onPoll is
// only a fallback, Gladys#3198), for each zone:
//   1. read the forecast again when the refresh policy says so
//      (src/forecast.js);
//   2. publish the states of the zone's device, if the user added it — only
//      the values that changed, plus a heartbeat (the SDK deduplicates);
//   3. when an hour begins, fire the scene triggers it matches.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { buildDevice, buildStates, deviceIds } from './device.js';
import { createForecast } from './forecast.js';
import { ActionFailure, MESSAGES, TEXT } from './i18n.js';
import { createIssueLog } from './issues.js';
import { createSceneLedger } from './ledger.js';
import { SCENE_ACTION, findCheapestWindow } from './scenes.js';
import { ZONES } from './source.js';
import { dayMonthTime } from './time.js';
import { eventsForSlot, TRIGGER } from './triggers.js';
import { buildForecastContent, formatPrice, WIDGET } from './widget.js';

const logger = createLogger({ name: 'spot-forecast' });

const MINUTE = 60 * 1000;
// A value that does not change (a weekly minimum) is sent again every 6
// hours: without a recent value, Gladys shows "no recent value".
export const HEARTBEAT_MS = 6 * 60 * MINUTE;
// The core's onPoll runs a cycle only when the timer missed one.
const POLL_FALLBACK_MS = 90 * 1000;
// An hour that began longer ago than this when the container saw it (started
// late, forecast just read) fires no trigger: a scene waiting for "the
// cheapest hours begin" must not run at 03:45.
export const LATE_EVENT_MS = 10 * MINUTE;

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the minute timer
 * @param {string} [options.dataDir] where the scene ledger is kept
 */
export function createApp(gladys, options = {}) {
  const now = options.now ?? (() => Date.now());
  const forecasts = Object.keys(ZONES).map((zone) =>
    createForecast({ zone, fetch: options.fetch, now }),
  );
  const ledger = createSceneLedger(options.dataDir ?? '/data');
  const issues = createIssueLog(logger);
  const timers = options.timers ?? true;

  let config = normalizeConfig();
  let timer = null;
  let stopped = false;
  let running = null;
  let lastCycleAt = null;
  let lastStatus = null;
  let announced = false;
  // Set once the configuration and the scene ledger are loaded.
  let initialized = false;
  let initializing = Promise.resolve();

  const deviceCreated = (zone) =>
    (gladys.devices ?? []).some((device) => device.external_id === deviceIds(gladys, zone).device);

  async function setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      lastStatus = key;
    } catch (err) {
      // Sent again on the next cycle.
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  /** Nudge the open dashboards; dropped silently while disconnected. */
  function refreshWidget() {
    try {
      gladys.requestWidgetRefresh(WIDGET.FORECAST);
    } catch (err) {
      logger.debug(`Widget refresh not sent (${err.message})`);
    }
  }

  /**
   * @param {ReturnType<typeof createForecast>} forecast
   * @param {string} reason
   * @param {{ rethrow?: boolean }} [options]
   */
  async function refresh(forecast, reason, { rethrow = false } = {}) {
    const { zone } = forecast;
    logger.debug(`Reading the ${zone} forecast (${reason})`);
    try {
      const { changed } = await forecast.refresh();
      const snapshot = forecast.snapshot(config);
      const summary = `${snapshot.upcoming.length} hours ahead`;
      if (!announced) {
        logger.info(`Forecast ${zone} reachable: ${summary}`);
        announced = true;
      } else {
        logger.debug(`Forecast ${zone} read: ${summary}${changed ? ', new forecast' : ''}`);
      }
      issues.ok(`api:${zone}`, `Forecast ${zone} answers again: ${summary}`);
      if (changed) {
        refreshWidget();
      }
    } catch (err) {
      issues.fail(`api:${zone}`, `Forecast ${zone} read failed (${err.message})`);
      if (rethrow) {
        throw err;
      }
    }
  }

  /** The status of the integration: the worst of the zones. */
  async function updateStatus() {
    for (const forecast of forecasts) {
      if (issues.isFailing(`api:${forecast.zone}`)) {
        await setStatus(false, TEXT.unreachable);
        return;
      }
      const snapshot = forecast.snapshot(config);
      if (snapshot.stale) {
        issues.fail(`stale:${forecast.zone}`, `Forecast ${forecast.zone} covers less than a day`);
        await setStatus(false, TEXT.stale);
        return;
      }
      issues.ok(`stale:${forecast.zone}`, `Forecast ${forecast.zone} covers the days ahead again`);
    }
    await setStatus(true);
  }

  async function publishStates(forecast) {
    if (!deviceCreated(forecast.zone)) {
      return;
    }
    try {
      const { count } = await gladys.publishChangedStates(
        buildStates(gladys, forecast.snapshot(config), config),
        { heartbeat: HEARTBEAT_MS },
      );
      if (count > 0) {
        logger.debug(`${count} state(s) published`);
      }
      issues.ok('states', 'States accepted by Gladys again');
    } catch (err) {
      issues.fail('states', `Publishing the states failed (${err.message})`);
    }
  }

  async function fireSceneEvents(forecast) {
    const { zone } = forecast;
    const snapshot = forecast.snapshot(config);
    const slot = snapshot.current;
    if (!slot || ledger.done(zone, slot.start)) {
      return;
    }
    if (now() - slot.start.getTime() > LATE_EVENT_MS) {
      logger.debug(`Hour ${slot.start.toISOString()} began too long ago: no scene event`);
      await ledger.markDone(zone, slot.start);
      return;
    }
    for (const event of eventsForSlot(snapshot.slots, slot, snapshot.timeZone)) {
      const id = `${zone}:${event.id}`;
      const windowEvent = event.key === TRIGGER.CHEAPEST_WINDOW;
      if (ledger.sent(slot.start, id) || (windowEvent && ledger.silent(id, now()))) {
        continue;
      }
      try {
        await gladys.publishSceneEvent(event.key, event.data);
        ledger.markSent(slot.start, id);
        if (windowEvent) {
          // With falling prices, the cheapest window starts "now" again an
          // hour later: one start per horizon.
          ledger.silence(id, event.until);
        }
        logger.debug(`Scene event ${id} (${event.data.start_time})`);
        issues.ok('scene', 'Scene events accepted by Gladys again');
      } catch (err) {
        // Tried again on the next cycle, within LATE_EVENT_MS.
        issues.fail('scene', `Firing the scene event ${event.key} failed (${err.message})`);
        return;
      }
    }
    await ledger.markDone(zone, slot.start);
  }

  async function runCycle({ forceRefresh = false } = {}) {
    lastCycleAt = now();
    for (const forecast of forecasts) {
      const reason = forceRefresh ? 'asked by the user' : forecast.dueReason();
      if (reason) {
        await refresh(forecast, reason, { rethrow: forceRefresh });
      }
    }
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: nothing published');
      return;
    }
    await updateStatus();
    for (const forecast of forecasts) {
      await publishStates(forecast);
      await fireSceneEvents(forecast);
    }
  }

  /**
   * One cycle; a second caller waits for the one in progress. A forced
   * refresh (the user's action) waits for it, then runs its own.
   */
  async function cycle(cycleOptions = {}) {
    while (running && cycleOptions.forceRefresh) {
      await running.catch(() => {});
    }
    if (running) {
      return running;
    }
    running = runCycle(cycleOptions);
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  // The timer ticks 2 s after every minute, so an hour that begins is seen
  // within seconds.
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    const delay = MINUTE - (now() % MINUTE) + 2000;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } catch (err) {
        logger.error(`Refresh cycle failed (${err.message})`);
      } finally {
        schedule();
      }
    }, delay);
  }

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(
      forecasts.map((forecast) => buildDevice(gladys, forecast.zone, config)),
    );
  }

  // --- Handlers ---------------------------------------------------------------

  gladys.onScanRequest(async () => {
    logger.debug('onScanRequest -> publishing the devices');
    await publishDevices();
  });

  // The fallback: the core polls the device (when it does, Gladys#3198).
  gladys.onPoll(async () => {
    // Not before the configuration and the scene ledger are loaded: a cycle
    // with an empty ledger would fire events again.
    if (!initialized) {
      logger.debug('onPoll skipped: not initialized yet');
      return;
    }
    if (lastCycleAt !== null && now() - lastCycleAt < POLL_FALLBACK_MS) {
      logger.debug('onPoll skipped: the timer is running');
      return;
    }
    await cycle();
  });

  // The device was just added: the SDK forgot what it had published (Gladys
  // drops the states of a feature that did not exist yet), send it all now.
  const onDeviceChange = async () => {
    gladys.forgetPublishedStates();
    for (const forecast of forecasts) {
      await publishStates(forecast);
    }
    refreshWidget();
  };
  gladys.onDeviceCreated(onDeviceChange);
  gladys.onDeviceUpdated(onDeviceChange);

  gladys.onAction('refresh', async () => {
    logger.info('Action refresh <- reading the forecast now');
    try {
      await cycle({ forceRefresh: true });
    } catch (err) {
      throw new ActionFailure(MESSAGES.refreshFailed(err.message));
    }
    const [forecast] = forecasts;
    const snapshot = forecast.snapshot(config);
    if (snapshot.upcoming.length === 0) {
      throw new ActionFailure(MESSAGES.refreshFailed('no hour ahead'));
    }
    return MESSAGES.refreshed({
      hours: snapshot.upcoming.length,
      until: dayMonthTime(snapshot.lastEnd, snapshot.timeZone, config.language),
      price: snapshot.current ? formatPrice(snapshot.current.price, config.language) : null,
    });
  });

  gladys.onSceneAction(SCENE_ACTION.CHEAPEST_WINDOW, async (fields) => {
    await initializing;
    const [forecast] = forecasts;
    // Nothing known yet (the container just started, the source was down):
    // one try.
    if (forecast.lastSuccessAt === null) {
      await cycle();
    }
    if (forecast.lastSuccessAt === null) {
      logger.info(`Scene action ${SCENE_ACTION.CHEAPEST_WINDOW} -> no forecast known`);
      throw new ActionFailure(MESSAGES.noForecastForScene);
    }
    const result = findCheapestWindow(forecast.snapshot(config), fields);
    if (result.invalid) {
      throw new ActionFailure(MESSAGES.invalidField(result.invalid));
    }
    logger.info(
      `Scene action ${SCENE_ACTION.CHEAPEST_WINDOW} (${fields?.hours} h within ${fields?.within} h) -> ` +
        (result.found ? `${result.start_date} ${result.start_time}` : 'no window'),
    );
    return result;
  });

  gladys.onWidgetGet(WIDGET.FORECAST, async ({ language, settings }) =>
    buildForecastContent({ snapshot: forecasts[0].snapshot(config), language, settings }),
  );

  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    config = normalizeConfig(newConfig);
    // Another window or language: every value may change, send them all again.
    gladys.forgetPublishedStates();
    await publishDevices();
    await cycle();
    refreshWidget();
  });

  gladys.on('connected', async () => {
    let done;
    if (!initialized) {
      initializing = new Promise((resolve) => {
        done = resolve;
      });
    }
    try {
      // Whatever was shown before the connection dropped, say it again.
      lastStatus = null;
      await ledger.load();
      config = normalizeConfig(await gladys.getConfig());
      initialized = true;
      done?.();
      await publishDevices();
      stopped = false;
      schedule();
      await cycle();
      // The nudges sent while the socket was down were dropped.
      refreshWidget();
    } catch (err) {
      logger.error(`Post-connection initialization failed (${err.message})`);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    } finally {
      done?.();
    }
  });

  return {
    forecasts,
    cycle,
    get config() {
      return config;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
