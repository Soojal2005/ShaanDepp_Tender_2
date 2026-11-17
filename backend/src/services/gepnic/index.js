/**
 * Lazy singleton for the GePNIC session manager, so the whole app shares one set
 * of warm browser contexts. Returns null when the feature is disabled.
 */
import { config } from '../../config.js';
import { GepnicSessionManager } from './sessionManager.js';

let manager = null;

export function getGepnicManager() {
  if (!config.gepnic?.enabled) return null;
  if (!manager) {
    manager = new GepnicSessionManager();
    manager.startHealthMonitor();
  }
  return manager;
}

export async function shutdownGepnic() {
  if (manager) {
    const m = manager;
    manager = null;
    await m.shutdown();
  }
}

/** Test hook: inject a manager (e.g. with a fake launchImpl) or reset. */
export function _setGepnicManager(m) { manager = m; }
