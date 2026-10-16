import type { RunStatus, Site } from './types';

export interface Settings {
  linkedinEnabled: boolean;
  closeTabAfterRun: boolean;
  /** Local times ("HH:MM") the extension captures. Claude curates a little after each. */
  runTimes: string[];
  /** X feed tabs to read: "following", "for-you". */
  xFeeds: string[];
}

export interface RunSummary {
  finishedAt: string;
  status: RunStatus;
  reason: string;
  postCount: number;
  /** Where the run was saved. */
  filename: string;
}

export interface State {
  settings: Settings;
  pausedUntil: Partial<Record<Site, number>>;
  lastRun: Partial<Record<Site, RunSummary>>;
}

export const DEFAULTS: State = {
  settings: { linkedinEnabled: false, closeTabAfterRun: true, runTimes: ['07:45', '17:45'], xFeeds: ['following', 'for-you'] },
  pausedUntil: {},
  lastRun: {},
};

export async function loadState(): Promise<State> {
  const got = (await chrome.storage.local.get(Object.keys(DEFAULTS) as (keyof State)[])) as Partial<State>;
  return {
    settings: { ...DEFAULTS.settings, ...got.settings },
    pausedUntil: got.pausedUntil ?? {},
    lastRun: got.lastRun ?? {},
  };
}

export async function saveState(patch: Partial<State>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export const PAUSE_MS = 48 * 60 * 60 * 1000;
