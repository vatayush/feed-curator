import { xAdapter } from '../src/adapters/x';
import { captureSafely, runCapture, type RunEnv } from '../src/content/runner';
import { tweet } from './fixtures/x';

/**
 * A fake X home page with a For you / Following tab strip. Clicking a tab swaps the timeline;
 * scrolling appends that tab's next batch. Ids: For you 100+, Following 200+, plus a shared 999.
 */
function fakeHome(opts: { opened?: 'for-you' | 'following'; perScroll?: number; batches?: number } = {}) {
  const perScroll = opts.perScroll ?? 3;
  const batches = opts.batches ?? 3;
  const make = (base: number, n: number) =>
    Array.from({ length: n }, (_, k) => tweet(String(base + k), `u${base + k}`, `U${base + k}`, `p${base + k}`)).join('');
  const timelines = {
    'for-you': Array.from({ length: batches }, (_, b) => make(100 + b * perScroll, perScroll) + (b === 0 ? tweet('999', 'both', 'Both', 'in both feeds') : '')),
    following: Array.from({ length: batches }, (_, b) => make(200 + b * perScroll, perScroll) + (b === 0 ? tweet('999', 'both', 'Both', 'in both feeds') : '')),
  };
  let selected: 'for-you' | 'following' = opts.opened ?? 'for-you';
  let page = 0;
  const clicks: string[] = [];
  const render = () => {
    document.body.innerHTML = `
      <div data-testid="ScrollSnap-List">
        <div role="tab" aria-selected="${selected === 'for-you'}">For you</div>
        <div role="tab" aria-selected="${selected === 'following'}">Following</div>
      </div>
      <div id="timeline">${timelines[selected][0]}</div>`;
    page = 0;
  };
  render();
  let t = 0;
  const env: RunEnv = {
    doc: document,
    url: () => new URL('https://x.com/home'),
    now: () => t,
    sleep: async ms => { t += ms; },
    scroll: () => {
      page++;
      const next = timelines[selected][page];
      if (next) document.getElementById('timeline')!.insertAdjacentHTML('beforeend', next);
    },
    scrollToTop: () => {},
    click: el => {
      selected = el.textContent!.trim() === 'Following' ? 'following' : 'for-you';
      clicks.push(selected);
      render();
    },
    firstPostsMs: 2000,
  };
  return { env, clicks, selected: () => selected };
}

describe('X feed tabs', () => {
  test('reads Following, then For you, and leaves X on For you', async () => {
    const home = fakeHome({ opened: 'for-you' });
    const file = await runCapture(xAdapter, home.env, ['following', 'for-you']);
    expect(file.status).toBe('ok');
    expect(file.feeds!.map(f => [f.name, f.postCount])).toEqual([['following', 10], ['for-you', 10]]);
    expect(file.postCount).toBe(19); // 9 + 9 unique, plus the one post in both
    expect(home.clicks).toEqual(['following', 'for-you']);
    expect(home.selected()).toBe('for-you');
  });

  test('tags each post with its feeds; a post in both is saved once', async () => {
    const file = await runCapture(xAdapter, fakeHome().env, ['following', 'for-you']);
    const feedsOf = (id: string) => file.posts.find(p => p.id === id)!.feeds;
    expect(feedsOf('x:200')).toEqual(['following']);
    expect(feedsOf('x:100')).toEqual(['for-you']);
    expect(feedsOf('x:999')).toEqual(['following', 'for-you']);
    expect(file.posts.filter(p => p.id === 'x:999')).toHaveLength(1);
  });

  test('if X opened on Following, For you is read first and X is left on Following', async () => {
    const home = fakeHome({ opened: 'following' });
    const file = await runCapture(xAdapter, home.env, ['following', 'for-you']);
    expect(file.feeds!.map(f => f.name)).toEqual(['for-you', 'following']);
    expect(home.selected()).toBe('following');
  });

  test('Following only', async () => {
    const home = fakeHome();
    const file = await runCapture(xAdapter, home.env, ['following']);
    expect(file.feeds!.map(f => f.name)).toEqual(['following']);
    expect(file.posts.every(p => p.feeds.includes('following'))).toBe(true);
    expect(file.posts.some(p => p.id === 'x:100')).toBe(false);
  });

  test('the per-feed post cap applies to each tab separately', async () => {
    const capped = { ...xAdapter, limits: { maxMs: 90_000, maxPosts: 5 } };
    const file = await runCapture(capped, fakeHome().env, ['following', 'for-you']);
    expect(file.feeds!.map(f => [f.postCount, f.reason])).toEqual([[5, 'reached 5 posts'], [5, 'reached 5 posts']]);
  });

  test('a Following tab that runs out early suggests sorting it by Recent', async () => {
    const file = await runCapture(xAdapter, fakeHome().env, ['following', 'for-you']);
    expect(file.feeds!.map(f => f.reason)).toEqual([
      'no new posts after several scrolls (if Following is sorted by Popular on X, switch it to Recent)',
      'no new posts after several scrolls',
    ]);
  });

  test('a missing tab strip is reported and nothing is clicked', async () => {
    const home = fakeHome();
    document.querySelector('[data-testid="ScrollSnap-List"]')!.remove();
    const file = await runCapture(xAdapter, home.env, ['following', 'for-you']);
    expect(file.feeds!.map(f => f.reason)).toEqual([
      "couldn't find the Following tab",
      "couldn't find the For you tab",
    ]);
    expect(home.clicks).toEqual([]);
  });

  test('unlabelled tabs are found by position only in the plain two-tab strip', () => {
    fakeHome();
    for (const t of document.querySelectorAll('[role="tab"]')) t.textContent = '…';
    const [following, forYou] = xAdapter.feeds!;
    expect(following.findTab(document)?.getAttribute('aria-selected')).toBe('false');
    expect(forYou.findTab(document)?.getAttribute('aria-selected')).toBe('true');
    document.querySelector('[data-testid="ScrollSnap-List"]')!.insertAdjacentHTML('beforeend', '<div role="tab">My list</div>');
    expect(following.findTab(document)).toBeNull();
    expect(forYou.findTab(document)).toBeNull();
  });
});

describe('captureSafely', () => {
  test('a capture that throws becomes a no_posts run with the error as its reason', async () => {
    const broken = { ...xAdapter, postElements: () => { throw new Error('layout changed'); } };
    const file = await captureSafely(broken, fakeHome().env, ['following']);
    expect(file.status).toBe('no_posts');
    expect(file.reason).toBe('capture failed: layout changed');
    expect(file.posts).toEqual([]);
  });
});
