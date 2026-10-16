import type { RunFile, Site } from './types';

export type Message =
  /** From the popup: start a run now in a new background tab. A manual run clears a pause. */
  | { type: 'begin-run'; site: Site; manual: true }
  /** From the content script on every feed visit: is this tab a run tab? */
  | { type: 'run-start'; site: Site }
  | { type: 'run-finish'; file: RunFile };

export type BeginRunReply =
  | { started: true }
  | { started: false; status: 'paused' | 'disabled'; reason: string };

export type RunStartReply = { run: true; feeds?: string[] } | { run: false };
