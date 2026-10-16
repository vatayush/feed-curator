import { linkedinAdapter } from '../src/adapters/linkedin';
import { post } from './fixtures/linkedin';

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
