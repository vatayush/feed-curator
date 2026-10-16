import { linkedinAdapter } from '../src/adapters/linkedin';
import { currentFeed, currentPost, post } from './fixtures/linkedin';

const now = new Date('2026-10-15T16:00:00Z');
const parseAll = (html: string) => {
  document.body.innerHTML = html;
  return linkedinAdapter.postElements(document).map(el => linkedinAdapter.parse(el, now));
};

describe('LinkedIn adapter', () => {
  test('parses a post without screen-reader duplicates', () => {
    const [r] = parseAll(post('7380', 'Priya Shah', 'priya-shah', 'We are hiring a founding engineer', { more: true }));
    expect(r).toEqual({
      kind: 'post',
      post: {
        id: 'linkedin:urn:li:activity:7380',
        site: 'linkedin',
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:7380/',
        author: { name: 'Priya Shah', handle: 'priya-shah', profileUrl: 'https://www.linkedin.com/in/priya-shah/' },
        text: 'We are hiring a founding engineer',
        truncated: true,
        postedAt: null,
        postedAtText: '3h',
        context: null,
        quoted: null,
        feeds: [],
        capturedAt: now.toISOString(),
      },
    });
  });

  test('keeps the "likes this" context', () => {
    const [r] = parseAll(post('1', 'A', 'a', 'text', { header: 'Sam Lee likes this' }));
    expect(r.kind === 'post' && r.post.context).toBe('Sam Lee likes this');
  });

  test('skips promoted posts', () => {
    const [r] = parseAll(post('2', 'Brand', 'brand', 'Buy', { sub: 'Promoted' }));
    expect(r).toEqual({ kind: 'promoted' });
  });

  test('counts nested urn containers once', () => {
    const html = `<div data-id="urn:li:activity:5"><div data-urn="urn:li:activity:5">${post('5', 'A', 'a', 't')}</div></div>`;
    document.body.innerHTML = html;
    expect(linkedinAdapter.postElements(document)).toHaveLength(1);
  });
});

describe('LinkedIn adapter, current layout', () => {
  test('parses a post: author from the post menu, text from the text box, no screen-reader text', () => {
    const [r] = parseAll(currentFeed(currentPost('Justin Fung', 'justinfung', "I'm hiring for two roles", { more: true })));
    expect(r.kind).toBe('post');
    if (r.kind !== 'post') return;
    expect(r.post).toMatchObject({
      site: 'linkedin',
      url: 'https://www.linkedin.com/in/justinfung/recent-activity/all/',
      author: { name: 'Justin Fung', handle: 'justinfung', profileUrl: 'https://www.linkedin.com/in/justinfung/' },
      text: "I'm hiring for two roles",
      truncated: true,
      postedAtText: '12h',
      context: null,
    });
    expect(r.post.id).toMatch(/^linkedin:h[0-9a-z]+$/);
  });

  test('only feed items with a post menu count: the share box, sort bar and suggestions are skipped', () => {
    document.body.innerHTML = currentFeed(currentPost('A', 'a', 'one'), currentPost('B', 'b', 'two'));
    expect(linkedinAdapter.postElements(document)).toHaveLength(2);
  });

  test('the same post gets the same id on every run, and different posts different ids', () => {
    const id = (html: string) => { const [r] = parseAll(currentFeed(html)); return r.kind === 'post' ? r.post.id : ''; };
    expect(id(currentPost('A', 'a', 'same text'))).toBe(id(currentPost('A', 'a', 'same text', { time: '3d' })));
    expect(id(currentPost('A', 'a', 'same text'))).not.toBe(id(currentPost('A', 'a', 'other text')));
  });

  test('keeps "likes this" with the liker, and the author is still the poster', () => {
    const [r] = parseAll(currentFeed(currentPost('Sean Park', 'seanpark', 'text', { liker: 'Sam Lee', time: 'Yesterday' })));
    expect(r.kind === 'post' && [r.post.context, r.post.author.handle, r.post.postedAtText])
      .toEqual(['Sam Lee likes this', 'seanpark', 'Yesterday']);
  });

  test('company posts link to the company page', () => {
    const [r] = parseAll(currentFeed(currentPost('Acme', 'acme', 'news', { company: true })));
    expect(r.kind === 'post' && r.post.url).toBe('https://www.linkedin.com/company/acme/posts/');
  });

  test('skips promoted posts', () => {
    const [r] = parseAll(currentFeed(currentPost('Dell', 'dell', 'Buy', { promoted: true, company: true })));
    expect(r).toEqual({ kind: 'promoted' });
  });

  test('scrolls the workspace panel, not the page', () => {
    document.body.innerHTML = currentFeed();
    expect(linkedinAdapter.scrollContainer?.(document)?.id).toBe('workspace');
  });
});

describe('LinkedIn challenge detection', () => {
  const check = (html: string, url = 'https://www.linkedin.com/feed/') => {
    document.body.innerHTML = html;
    return linkedinAdapter.detectChallenge(document, new URL(url));
  };
  test('feed is fine', () => expect(check(post('1', 'A', 'a', 'security check tips'))).toBeNull());
  test('checkpoint', () => expect(check('', 'https://www.linkedin.com/checkpoint/challenge/x')).toMatch(/verification/));
  test('authwall', () => expect(check('', 'https://www.linkedin.com/authwall?x=1')).toMatch(/login/));
  test('login form', () => expect(check('<input id="username"><input id="password">')).toBe('login form'));
});
