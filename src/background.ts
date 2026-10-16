import type { BeginRunReply, Message, RunStartReply } from './messages';
import { nextOccurrence, ALARM_PREFIX, alarmTime, isStale, LINKEDIN_DELAY_MIN } from './schedule';
import { loadState, PAUSE_MS, saveState } from './storage';
import { FEED_URLS, type RunFile, type Site } from './types';

const FOLDER = 'feed-curator';
const KEEP_DAYS = 30;
const DOWNLOAD_WAIT_MS = 30_000;
/** The helper in host/ that writes captures into the project's captures/ folder. */
const HOST = 'com.feedcurator.host';
/** A run tab that hasn't reached its feed within this time is forgotten. */
const RUN_TAB_TTL_MS = 2 * 60 * 1000;
const LINKEDIN_FOLLOWUP = 'linkedin-followup';
/** A LinkedIn run this soon after an X run with posts curates both, even if LinkedIn found none. */
const CURATE_WITH_X_MS = 15 * 60 * 1000;

type RunTabs = Record<string, { site: Site; at: number }>;

chrome.runtime.onMessage.addListener((msg: Message, sender, reply) => {
  if (msg.type === 'begin-run') {
    beginRun(msg.site, { manual: true }).then(reply);
    return true;
  }
  if (msg.type === 'run-start') {
    onRunStart(msg.site, sender.tab?.id).then(reply);
    return true;
  }
  if (msg.type === 'run-finish') {
    onRunFinish(msg.file, sender.tab?.id).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

// --- Schedule: Chrome's own alarms start runs; nothing outside the browser is involved. ---

chrome.runtime.onInstalled.addListener(() => void scheduleRuns());
chrome.runtime.onStartup.addListener(() => void scheduleRuns());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) void scheduleRuns();
});

async function scheduleRuns() {
  const { settings } = await loadState();
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith(ALARM_PREFIX)) await chrome.alarms.clear(a.name);
  }
  for (const time of settings.runTimes) await scheduleNext(time);
}

/**
 * One-shot alarms, each set from the clock when the last one fires. A 24-hour repeat would
 * drift an hour at daylight-saving changes, away from the curation that follows each capture.
 */
async function scheduleNext(time: string) {
  await chrome.alarms.create(`${ALARM_PREFIX}${time}`, { when: nextOccurrence(time, new Date()) });
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === LINKEDIN_FOLLOWUP) {
    await beginRun('linkedin');
    return;
  }
  const time = alarmTime(alarm.name);
  if (!time) return;
  await scheduleNext(time);
  // Chrome fires a missed alarm when it next starts; a run hours late would surprise you.
  if (isStale(alarm.scheduledTime, Date.now())) return;
  await beginRun('x');
  // LinkedIn goes a few minutes later, so the two sites are never read at once.
  const { settings } = await loadState();
  if (settings.linkedinEnabled) {
    await chrome.alarms.create(LINKEDIN_FOLLOWUP, { delayInMinutes: LINKEDIN_DELAY_MIN });
  }
});

// --- Runs ---

// Run tabs live in session storage: in memory only, and the service worker may restart mid-run.
async function getRunTabs(): Promise<RunTabs> {
  return ((await chrome.storage.session.get('runTabs')).runTabs as RunTabs | undefined) ?? {};
}

/**
 * Opens a background tab, marks it as a run tab, then sends it to the plain feed URL.
 * A pause only holds back scheduled runs; pressing Run now is your call and clears it.
 */
async function beginRun(site: Site, opts: { manual?: boolean } = {}): Promise<BeginRunReply> {
  const state = await loadState();
  if (opts.manual && state.pausedUntil[site]) {
    delete state.pausedUntil[site];
    await saveState({ pausedUntil: state.pausedUntil });
  }
  const blocked = blockReason(site, state);
  if (blocked) {
    // Record why, so Claude finds an explanation instead of a stale file. The site is not visited.
    const now = new Date().toISOString();
    await onRunFinish({
      version: 1, site, startedAt: now, finishedAt: now, status: blocked.status, reason: blocked.reason,
      pageUrl: '', postCount: 0, skippedPromoted: 0, posts: [],
    }, undefined);
    return { started: false, ...blocked };
  }

  // Start blank and register the tab before it navigates, so the content script's first
  // question always finds it.
  const tabId = await openBlankTab();
  const runTabs = await getRunTabs();
  runTabs[tabId] = { site, at: Date.now() };
  await chrome.storage.session.set({ runTabs });
  await chrome.tabs.update(tabId, { url: FEED_URLS[site] });
  return { started: true };
}

async function openBlankTab(): Promise<number> {
  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    return tab.id!;
  } catch {
    // No open window (Chrome running in the background on macOS): use a minimised one.
    const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    return win!.tabs![0].id!;
  }
}

function blockReason(site: Site, state: Awaited<ReturnType<typeof loadState>>) {
  if (site === 'linkedin' && !state.settings.linkedinEnabled) {
    return { status: 'disabled' as const, reason: 'LinkedIn capture is turned off in Feed Curator settings' };
  }
  if (site === 'x' && !state.settings.xFeeds.length) {
    return { status: 'disabled' as const, reason: 'both X feeds are turned off in Feed Curator settings' };
  }
  const until = state.pausedUntil[site];
  if (until && until > Date.now()) {
    return {
      status: 'paused' as const,
      reason: `paused until ${new Date(until).toISOString()} after an earlier login, captcha or rate-limit page`,
    };
  }
  return null;
}

/** One-shot: a run tab runs once; later visits in the same tab are ordinary browsing. */
async function onRunStart(site: Site, tabId: number | undefined): Promise<RunStartReply> {
  if (tabId === undefined) return { run: false };
  const runTabs = await getRunTabs();
  const entry = runTabs[tabId];
  if (!entry) return { run: false };
  delete runTabs[tabId];
  await chrome.storage.session.set({ runTabs });
  if (entry.site !== site || Date.now() - entry.at >= RUN_TAB_TTL_MS) return { run: false };
  const { settings } = await loadState();
  return { run: true, ...(site === 'x' && { feeds: settings.xFeeds }) };
}

async function onRunFinish(file: RunFile, tabId: number | undefined) {
  const state = await loadState();
  if (file.status === 'stopped') {
    state.pausedUntil[file.site] = Date.now() + PAUSE_MS;
  }

  const stamp = file.finishedAt.replace(/[:.]/g, '-');
  const json = JSON.stringify(file, null, 2);
  const curate = await shouldCurate(file, state);
  const filename = await saveRun(file.site, stamp, json, curate);

  state.lastRun[file.site] = {
    finishedAt: file.finishedAt,
    status: file.status,
    reason: file.reason,
    postCount: file.postCount,
    filename,
  };
  await saveState({ pausedUntil: state.pausedUntil, lastRun: state.lastRun });

  // Only close tabs the run actually used; a challenge page is left open so you can see it.
  if (tabId !== undefined && state.settings.closeTabAfterRun && file.status !== 'stopped') {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

/**
 * Whether the helper should start a curation pass after saving this run. With LinkedIn on, the X
 * run leaves it to the LinkedIn run that follows, so both sites are curated together, once.
 */
async function shouldCurate(file: RunFile, state: Awaited<ReturnType<typeof loadState>>): Promise<boolean> {
  if (file.site === 'x') {
    const linkedinNext = state.settings.linkedinEnabled && !!(await chrome.alarms.get(LINKEDIN_FOLLOWUP));
    return !linkedinNext && file.postCount > 0;
  }
  const x = state.lastRun.x;
  const xRecent = !!x && x.postCount > 0 && Date.now() - Date.parse(x.finishedAt) < CURATE_WITH_X_MS;
  return file.postCount > 0 || xRecent;
}

/**
 * Saves a run into the project's captures folder through the native helper, which may then start curation. If the helper isn't
 * installed, falls back to ~/Downloads/feed-curator so the capture isn't lost. Returns where it went.
 */
async function saveRun(site: Site, stamp: string, json: string, curate: boolean): Promise<string> {
  try {
    const res = await chrome.runtime.sendNativeMessage(HOST, { type: 'save', site, stamp, json, curate });
    if (res?.ok) return res.path;
    console.warn('[feed-curator] helper refused the save:', res?.error);
  } catch (e) {
    console.warn('[feed-curator] helper unavailable, saving to Downloads:', e);
  }
  const filename = `${FOLDER}/${site}-${stamp}.json`;
  await download(filename, json);
  await download(`${FOLDER}/${site}-latest.json`, json);
  await pruneOldDownloads();
  return `Downloads/${filename} (helper not installed: see README)`;
}

async function download(filename: string, json: string) {
  // Keep the download bubble from popping up on every run.
  await chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});
  try {
    const id = await chrome.downloads.download({
      url: toDataUrl(json),
      filename,
      conflictAction: 'overwrite',
      saveAs: false,
    });
    await waitForDownload(id);
  } finally {
    await chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
  }
}

/** Waits for a download to end, or 30 s at most: a stuck one must not hold up the run's record. */
function waitForDownload(id: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      resolve();
    };
    const listener = (d: chrome.downloads.DownloadDelta) => {
      if (d.id === id && d.state && d.state.current !== 'in_progress') done();
    };
    const timer = setTimeout(done, DOWNLOAD_WAIT_MS);
    chrome.downloads.onChanged.addListener(listener);
    // Small data URLs often finish before the listener is attached.
    chrome.downloads.search({ id }).then(([d]) => {
      if (d && d.state !== 'in_progress') done();
    });
  });
}

function toDataUrl(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:application/json;base64,${btoa(bin)}`;
}

/** Deletes timestamped run files older than 30 days. The -latest files are kept. */
async function pruneOldDownloads() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const old = await chrome.downloads.search({
    filenameRegex: `${FOLDER}[/\\\\](x|linkedin)-\\d`,
    endedBefore: cutoff,
  });
  for (const d of old) {
    await chrome.downloads.removeFile(d.id).catch(() => {});
    await chrome.downloads.erase({ id: d.id });
  }
}
