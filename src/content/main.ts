import { adapters, siteForHost } from '../adapters';
import type { Message, RunStartReply } from '../messages';
import { captureSafely } from './runner';

// Runs on every feed visit, but does nothing unless the background worker says this tab was
// opened for a run. Nothing on the page is changed either way.
const site = siteForHost(location.hostname);
if (site) void start(site);

async function start(s: NonNullable<typeof site>) {
  const send = (msg: Message) => chrome.runtime.sendMessage(msg);
  const reply: RunStartReply = await send({ type: 'run-start', site: s });
  if (!reply.run) return;

  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }

  const file = await captureSafely(adapters[s], {
    doc: document,
    url: () => new URL(location.href),
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    // Instant, not smooth: a smooth scroll animates on rendered frames, which a background tab
    // doesn't get, so the page may never move. 1.3 screens a step: an X post averages about one
    // screen in a small window, and the observer still sees every post the list renders.
    scroll: () => window.scrollBy(0, Math.round(window.innerHeight * 1.3)),
    scrollToTop: () => window.scrollTo(0, 0),
    click: el => el.click(),
    pageState: () => ({
      visibility: document.visibilityState,
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }),
  }, reply.feeds);
  await send({ type: 'run-finish', file });
}
