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

  const adapter = adapters[s];
  // Some feeds scroll inside a panel instead of the page. Looked up on every use: it may mount late.
  const panel = () => adapter.scrollContainer?.(document) ?? null;
  const file = await captureSafely(adapter, {
    doc: document,
    url: () => new URL(location.href),
    now: () => Date.now(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    // Instant, not smooth: a smooth scroll animates on rendered frames, which a background tab
    // doesn't get, so the page may never move. 1.3 screens a step: an X post averages about one
    // screen in a small window, and the observer still sees every post the list renders.
    scroll: () => {
      const el = panel() ?? document.scrollingElement ?? document.documentElement;
      const target = el === document.scrollingElement ? window : el;
      // At the very bottom a further scroll moves nothing and fires no scroll event, and feeds
      // that load more on scroll then wait forever. Step back half a screen and return instead.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
        target.scrollBy(0, -Math.round(el.clientHeight / 2));
        setTimeout(() => target.scrollTo(0, el.scrollHeight), 250);
      } else {
        target.scrollBy(0, Math.round(el.clientHeight * 1.3));
      }
    },
    scrollToTop: () => (panel() ?? window).scrollTo(0, 0),
    click: el => el.click(),
    pageState: () => {
      const el = panel();
      return {
        visibility: document.visibilityState,
        scrollY: Math.round(el ? el.scrollTop : window.scrollY),
        scrollHeight: el ? el.scrollHeight : document.documentElement.scrollHeight,
        innerHeight: el ? el.clientHeight : window.innerHeight,
      };
    },
  }, reply.feeds);
  await send({ type: 'run-finish', file });
}
