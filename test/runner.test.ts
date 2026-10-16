import { xAdapter as xWithTabs } from '../src/adapters/x';

/** Single-feed tests: the X adapter without its For you / Following tabs. */
const xAdapter: Adapter = { ...xWithTabs, feeds: undefined };
import { runCapture, type RunEnv } from '../src/content/runner';
import type { Adapter } from '../src/types';
import { tweet } from './fixtures/x';

/** A fake page: each scroll appends the next batch of posts; time advances only on sleep. */
function fakePage(batches: string[], opts: { onScroll?: (i: number) => void; url?: string } = {}) {
  let t = 0;
  let i = 0;
  let url = opts.url ?? 'https://x.com/home';
  document.body.innerHTML = batches[0] ?? '';
  const env: RunEnv = {
    doc: document,
    url: () => new URL(url),
    now: () => t,
    sleep: async ms => { t += ms; },
    scroll: () => {
      i++;
      if (batches[i]) document.body.insertAdjacentHTML('beforeend', batches[i]);
      opts.onScroll?.(i);
    },
    scrollToTop: () => {},
    click: () => {},
    firstPostsMs: 2000,
  };
  return { env, setUrl: (u: string) => { url = u; } };
}

const batch = (from: number, n: number) =>
  Array.from({ length: n }, (_, k) => tweet(String(from + k), `user${from + k}`, `User ${from + k}`, `post ${from + k}`)).join('');

describe('runCapture', () => {
  test('collects posts until the post cap', async () => {
    const small: Adapter = { ...xAdapter, limits: { maxMs: 90_000, maxPosts: 12 } };
    const { env } = fakePage([batch(0, 5), batch(5, 5), batch(10, 5), batch(15, 5)]);
    const file = await runCapture(small, env);
    expect(file.status).toBe('ok');
    expect(file.postCount).toBe(12);
    expect(file.reason).toBe('reached 12 posts');
  });

  test('stops at the end of the feed', async () => {
    const { env } = fakePage([batch(0, 3)]);
    const file = await runCapture(xAdapter, env);
    expect(file.status).toBe('ok');
    expect(file.postCount).toBe(3);
    expect(file.reason).toMatch(/no new posts/);
  });

  test('stops at the time cap', async () => {
    const quick: Adapter = { ...xAdapter, limits: { maxMs: 5000, maxPosts: 999 } };
    const batches = Array.from({ length: 50 }, (_, k) => batch(k * 2, 2));
    const file = await runCapture(quick, fakePage(batches).env);
    expect(file.reason).toBe('reached 5 s');
  });

  test('a login page mid-run stops the run and keeps what was captured', async () => {
    const page = fakePage([batch(0, 4), batch(4, 4)], {
      onScroll: i => { if (i === 2) page.setUrl('https://x.com/i/flow/login'); },
    });
    const file = await runCapture(xAdapter, page.env);
    expect(file.status).toBe('stopped');
    expect(file.reason).toMatch(/^stopped: login/);
    expect(file.postCount).toBe(8);
  });

  test('a login page at the start never scrolls', async () => {
    let scrolls = 0;
    const page = fakePage([''], { url: 'https://x.com/login', onScroll: () => scrolls++ });
    const file = await runCapture(xAdapter, page.env);
    expect(file.status).toBe('stopped');
    expect(scrolls).toBe(0);
  });

  test('an empty page reports no_posts so a broken adapter is visible', async () => {
    const file = await runCapture(xAdapter, fakePage(['<div>loading</div>']).env);
    expect(file.status).toBe('no_posts');
    expect(file.posts).toEqual([]);
  });

  test("X's hidden fallback error text does not stop a run (the 2026-10-16 bug)", async () => {
    const shell = '<div style="display:none"><span>Something went wrong, but don\u2019t fret \u2014 let\u2019s give it another shot.</span><button>Try again</button></div>';
    // The feed arrives after the first check, as on the real site.
    let polls = 0;
    const page = fakePage([shell]);
    const sleep = page.env.sleep;
    page.env.sleep = async ms => {
      if (++polls === 3) document.body.insertAdjacentHTML('beforeend', batch(0, 3));
      await sleep(ms);
    };
    const file = await runCapture(xAdapter, page.env);
    expect(file.status).toBe('ok');
    expect(file.postCount).toBe(3);
  });

  test('a rate-limit page with no feed stops and pauses', async () => {
    const file = await runCapture(xAdapter, fakePage(['<div>Sorry, you are rate limited.</div>']).env);
    expect(file.status).toBe('stopped');
    expect(file.reason).toBe('stopped: X showed "rate limited"');
  });

  test('a generic error page with no feed reports no_posts without pausing', async () => {
    let scrolls = 0;
    const file = await runCapture(xAdapter, fakePage(['<div>Something went wrong. Try reloading.</div>'], { onScroll: () => scrolls++ }).env);
    expect(file.status).toBe('no_posts');
    expect(file.reason).toBe('X showed an error page instead of the feed');
    expect(scrolls).toBe(0);
  });

  test('posts collected by the observer between scrolls still count as progress (the 2026-10-16 short-run bug)', async () => {
    const batches = Array.from({ length: 12 }, (_, k) => batch(k * 2, 2));
    const page = fakePage(batches);
    // Let real time pass during each sleep so the MutationObserver's debounced collect runs first.
    const sleep = page.env.sleep;
    page.env.sleep = async ms => { await sleep(ms); await new Promise(r => setTimeout(r, 300)); };
    const file = await runCapture(xAdapter, page.env);
    expect(file.postCount).toBe(24);
    expect(file.reason).toMatch(/no new posts/);
  }, 20_000);

  test('ads are counted, not captured', async () => {
    const { ad } = await import('./fixtures/x');
    const file = await runCapture(xAdapter, fakePage([ad + batch(0, 2)]).env);
    expect(file.postCount).toBe(2);
    expect(file.skippedPromoted).toBe(1);
  });
});
