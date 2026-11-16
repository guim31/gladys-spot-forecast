// -----------------------------------------------------------------------------
// Which hours already fired their scene events, and which cheapest-window
// choices stay silent until the window they announced ends.
//
// Kept in /data (the one writable volume) so a container restarted a minute
// after 03:00 does not start the dishwasher a second time. Losing the file is
// harmless (at worst one hour fires again); failing to write it is logged in
// debug only, the ledger in memory carries on.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'spot-forecast:ledger' });
const FILE = 'scene-events.json';

/** @param {string} dataDir */
export function createSceneLedger(dataDir) {
  const path = join(dataDir, FILE);
  // Per zone: the start (ms) of the last hour whose events are all out.
  let doneUntil = {};
  // Per event id ("zone:key:choice"): silent until this instant (ms).
  let silentUntil = {};
  // The events already out for the hour in progress, when one failed.
  let partial = { slot: null, ids: new Set() };

  async function save() {
    try {
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        `${path}.tmp`,
        JSON.stringify({ done_until: doneUntil, silent_until: silentUntil }),
      );
      await rename(`${path}.tmp`, path);
    } catch (err) {
      logger.debug(`Scene ledger not saved (${err.message})`);
    }
  }

  const numbers = (value) =>
    Object.fromEntries(
      Object.entries(value && typeof value === 'object' ? value : {}).filter(([, v]) =>
        Number.isFinite(v),
      ),
    );

  return {
    async load() {
      try {
        const saved = JSON.parse(await readFile(path, 'utf8'));
        doneUntil = { ...numbers(saved.done_until), ...doneUntil };
        silentUntil = { ...numbers(saved.silent_until), ...silentUntil };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.debug(`Scene ledger unreadable, starting afresh (${err.message})`);
        }
      }
    },

    /** @param {string} zone @param {Date} start */
    done(zone, start) {
      return doneUntil[zone] !== undefined && start.getTime() <= doneUntil[zone];
    },

    /** @param {string} id @param {number} at ms */
    silent(id, at) {
      return silentUntil[id] !== undefined && at < silentUntil[id];
    },

    /** @param {string} id @param {number} until ms */
    silence(id, until) {
      silentUntil[id] = until;
    },

    /** @param {Date} start @param {string} id */
    sent(start, id) {
      return partial.slot === start.getTime() && partial.ids.has(id);
    },

    /** @param {Date} start @param {string} id */
    markSent(start, id) {
      if (partial.slot !== start.getTime()) {
        partial = { slot: start.getTime(), ids: new Set() };
      }
      partial.ids.add(id);
    },

    /** @param {string} zone @param {Date} start */
    async markDone(zone, start) {
      doneUntil[zone] = start.getTime();
      partial = { slot: null, ids: new Set() };
      // Forget the silences that are over: the file stays small.
      for (const [id, until] of Object.entries(silentUntil)) {
        if (until <= start.getTime()) {
          delete silentUntil[id];
        }
      }
      await save();
    },
  };
}
