import type { Adapter, FeedResult, FeedTab, PageState, Post, RunFile } from '../types';

export interface RunEnv {
  doc: Document;
  url: () => URL;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  scroll: () => void;
  scrollToTop: () => void;
  click: (el: HTMLElement) => void;
  /** Snapshot of the page, recorded at the start and end of the run. */
  pageState?: () => PageState;
  /** Pause between scrolls. */
  stepMs?: number;
  /** How long to wait for the first posts before scrolling. */
  firstPostsMs?: number;
  /** Scrolls in a row with no new posts before treating the feed as ended. */
  staleLimit?: number;
  /** How long to wait for a feed tab switch to show new posts. */
  switchMs?: number;
}

const isSelected = (tab: HTMLElement | null) => tab?.getAttribute('aria-selected') === 'true';

/**
 * Like runCapture, but an error (say, after a site redesign) becomes a no_posts run that says
 * what went wrong, so the popup and the curation see a reason instead of nothing.
 */
export async function captureSafely(adapter: Adapter, env: RunEnv, feedNames?: string[]): Promise<RunFile> {
  const startedAt = new Date(env.now()).toISOString();
  try {
    return await runCapture(adapter, env, feedNames);
  } catch (e) {
    return {
      version: 1, site: adapter.site, startedAt, finishedAt: new Date(env.now()).toISOString(),
      status: 'no_posts', reason: `capture failed: ${e instanceof Error ? e.message : String(e)}`,
      pageUrl: env.url().href, postCount: 0, skippedPromoted: 0, posts: [],
    };
  }
}

/**
 * Scrolls each requested feed tab in turn (or the one feed, for sites without tabs), collecting
 * posts until a per-feed cap, the feed's end, or a challenge page.
 */
export async function runCapture(adapter: Adapter, env: RunEnv, feedNames?: string[]): Promise<RunFile> {
  const { maxMs, maxPosts } = adapter.limits;
  const stepMs = env.stepMs ?? 1800;
  const staleLimit = env.staleLimit ?? 6;
  const startedAt = env.now();
  const posts = new Map<string, Post>();
  const promoted = new WeakSet<Element>();
  let skippedPromoted = 0;

  // The feed being read now; null while switching, so posts from the old tab aren't misfiled.
  let current: { name: string; seen: Set<string> } | null = null;

  const parsedIds = () => {
    const ids = new Set<string>();
    for (const el of adapter.postElements(env.doc)) {
      const r = adapter.parse(el, new Date(env.now()));
      if (r.kind === 'post') ids.add(r.post.id);
    }
    return ids;
  };

  const collect = () => {
    const feed = current;
    if (!feed) return;
    for (const el of adapter.postElements(env.doc)) {
      if (feed.seen.size >= maxPosts) return;
      if (promoted.has(el)) continue;
      const r = adapter.parse(el, new Date(env.now()));
      if (r.kind === 'promoted') {
        promoted.add(el);
        skippedPromoted++;
      } else if (r.kind === 'post' && !feed.seen.has(r.post.id)) {
        feed.seen.add(r.post.id);
        const existing = posts.get(r.post.id);
        if (existing) existing.feeds.push(feed.name);
        else posts.set(r.post.id, { ...r.post, feeds: [feed.name] });
      }
    }
  };
  const challenge = () => adapter.detectChallenge(env.doc, env.url());

  // Sites recycle post elements as you scroll, so also collect whenever the feed changes.
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    let pending = false;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        collect();
      }, 250);
    });
    observer.observe(env.doc.documentElement, { childList: true, subtree: true });
  }

  /** Clicks a feed tab and waits until it's selected and showing posts the old tab wasn't. */
  const switchTo = async (feed: FeedTab): Promise<string | null> => {
    const tab = feed.findTab(env.doc);
    if (!tab) return `couldn't find the ${feed.label} tab`;
    if (isSelected(tab)) return null;
    current = null;
    env.scrollToTop();
    await env.sleep(300);
    const before = parsedIds();
    env.click(tab);
    const t0 = env.now();
    const switchMs = env.switchMs ?? 10_000;
    while (env.now() - t0 < switchMs) {
      await env.sleep(250);
      if (!isSelected(feed.findTab(env.doc))) continue;
      if ([...parsedIds()].some(id => !before.has(id))) return null;
    }
    // Selected but nothing new yet: carry on and let the first-posts wait decide.
    return isSelected(feed.findTab(env.doc)) ? null : `the ${feed.label} tab didn't open`;
  };

  // The tab strip renders with the timeline, after the page itself: wait for it before deciding
  // which tab the page opened on. Read that one last, so the site is left as you had it.
  const requested = (adapter.feeds ?? []).filter(f => !feedNames || feedNames.includes(f.name));
  const waitStart = env.now();
  while (requested.length && !requested.some(f => f.findTab(env.doc)) && !challenge()
         && env.now() - waitStart < (env.firstPostsMs ?? 15_000)) {
    await env.sleep(500);
  }
  const opened = requested.find(f => isSelected(f.findTab(env.doc)));
  const plan: (FeedTab | null)[] = requested.length
    ? [...requested.filter(f => f !== opened), ...(opened ? [opened] : [])]
    : [null];

  const startState = env.pageState?.();
  const feeds: FeedResult[] = [];
  let scrolls = 0;
  let stop = challenge();
  let errorPage: string | null = null;

  try {
    for (const [i, feed] of plan.entries()) {
      if (stop) break;
      const name = feed?.name ?? 'feed';
      if (feed) {
        const failed = await switchTo(feed);
        if (failed) { feeds.push({ name, postCount: 0, reason: failed }); continue; }
      }
      const seen = new Set<string>();
      current = { name, seen };
      const feedStart = env.now();
      const elapsed = () => env.now() - feedStart;

      const firstPostsMs = env.firstPostsMs ?? 15_000;
      while (!stop && !seen.size && elapsed() < firstPostsMs) {
        collect();
        if (seen.size) break;
        await env.sleep(500);
        stop = challenge();
      }

      // No feed after the wait: say why if the page shows it, and don't scroll a broken page.
      if (!stop && !seen.size) {
        const err = adapter.detectErrorPage(env.doc);
        if (err?.pause) stop = err.reason;
        else if (i === 0 || !feed) errorPage = err?.reason ?? null;
        feeds.push({ name, postCount: 0, reason: err?.reason ?? 'no posts appeared' });
        continue;
      }

      // Compare with the count at the previous scroll, not just before collect(): the observer
      // collects between scrolls, so new posts may already be counted by now.
      let reason = '';
      let stale = 0;
      let lastSize = seen.size;
      while (!stop) {
        if (seen.size >= maxPosts) { reason = `reached ${maxPosts} posts`; break; }
        if (elapsed() >= maxMs) { reason = `reached ${Math.round(maxMs / 1000)} s`; break; }
        if (stale >= staleLimit) {
          reason = 'no new posts after several scrolls';
          if (feed?.shortHint && seen.size < maxPosts / 2) reason += ` (${feed.shortHint})`;
          break;
        }
        env.scroll();
        scrolls++;
        await env.sleep(stepMs);
        stop = challenge();
        if (stop) break;
        collect();
        stale = seen.size === lastSize ? stale + 1 : 0;
        lastSize = seen.size;
      }
      feeds.push({ name, postCount: seen.size, reason: stop ? `stopped: ${stop}` : reason });
    }
  } finally {
    current = null;
    observer?.disconnect();
  }

  const status = stop ? 'stopped' : posts.size ? 'ok' : 'no_posts';
  const reason = stop
    ? `stopped: ${stop}`
    : !posts.size
      ? errorPage ?? 'page loaded but no posts were recognised; the site layout may have changed'
      : feeds.map(f => (plan[0] ? `${f.name}: ${f.reason}` : f.reason)).join('; ');

  return {
    version: 1,
    site: adapter.site,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(env.now()).toISOString(),
    status,
    reason,
    pageUrl: env.url().href,
    postCount: posts.size,
    skippedPromoted,
    ...(plan[0] && { feeds }),
    ...(startState && { diagnostics: { scrolls, start: startState, end: env.pageState!() } }),
    posts: [...posts.values()],
  };
}
