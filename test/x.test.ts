import { xAdapter } from '../src/adapters/x';
import { ad, repostContext, tweet, withQuote } from './fixtures/x';

const now = new Date('2026-10-15T16:00:00Z');
const parseFirst = (html: string) => {
  document.body.innerHTML = html;
  const [el] = xAdapter.postElements(document);
  return xAdapter.parse(el, now);
};

describe('X adapter', () => {
  test('parses a plain post', () => {
    const r = parseFirst(tweet('123', 'jane_dev', 'Jane Dev', 'Shipped our Postgres migration today'));
    expect(r).toEqual({
      kind: 'post',
      post: {
        id: 'x:123',
        site: 'x',
        url: 'https://x.com/jane_dev/status/123',
        author: { name: 'Jane Dev', handle: '@jane_dev', profileUrl: 'https://x.com/jane_dev' },
        text: 'Shipped our Postgres migration today',
        truncated: false,
        postedAt: '2026-10-15T14:03:00.000Z',
        postedAtText: null,
        context: null,
        quoted: null,
        feeds: [],
        capturedAt: now.toISOString(),
      },
    });
  });

  test('keeps repost context and the original author', () => {
    const r = parseFirst(tweet('9', 'orig', 'Original', 'hello', repostContext('Jane Dev')));
    expect(r.kind === 'post' && r.post.context).toBe('Jane Dev reposted');
    expect(r.kind === 'post' && r.post.author.handle).toBe('@orig');
  });

  test('separates a quoted post and flags truncation', () => {
    const r = parseFirst(withQuote);
    if (r.kind !== 'post') throw new Error(r.kind);
    expect(r.post.id).toBe('x:111');
    expect(r.post.text).toBe('This is the right take 👇');
    expect(r.post.truncated).toBe(true);
    expect(r.post.postedAt).toBe('2026-10-15T10:00:00.000Z');
    expect(r.post.quoted).toEqual({ author: '@patk', text: 'Small teams ship faster.\nFight me.' });
  });

  test('skips ads', () => {
    expect(parseFirst(ad)).toEqual({ kind: 'promoted' });
  });

  test('a post that merely mentions "Ad" is not treated as an ad', () => {
    expect(parseFirst(tweet('5', 'a', 'A', 'Ad')).kind).toBe('post');
  });
});

describe('X challenge detection', () => {
  const check = (html: string, url = 'https://x.com/home') => {
    document.body.innerHTML = html;
    return xAdapter.detectChallenge(document, new URL(url));
  };

  test('normal feed is not a challenge', () => {
    expect(check(tweet('1', 'a', 'A', 'post about rate limit design'))).toBeNull();
  });
  test('login flow', () => {
    expect(check('<div>Sign in to X</div>', 'https://x.com/i/flow/login')).toMatch(/login/);
  });
  test('logged-out page', () => {
    expect(check('<a data-testid="loginButton">Log in</a>')).toBe('logged out');
  });
  test('captcha', () => {
    expect(check('<iframe src="https://client-api.arkoselabs.com/x"></iframe>')).toBe('captcha');
  });
});

describe('X error pages', () => {
  const check = (html: string) => {
    document.body.innerHTML = html;
    return xAdapter.detectErrorPage(document);
  };
  test('rate limit pauses', () => {
    expect(check('<div>Sorry, you are rate limited. Please wait a few moments then try again.</div>'))
      .toEqual({ reason: 'X showed "rate limited"', pause: true });
  });
  test('generic error does not pause', () => {
    expect(check('<div>Something went wrong. Try reloading.</div>')?.pause).toBe(false);
  });
  test('rate-limit text is not a hard challenge', () => {
    document.body.innerHTML = '<div>rate limited</div>';
    expect(xAdapter.detectChallenge(document, new URL('https://x.com/home'))).toBeNull();
  });
});
