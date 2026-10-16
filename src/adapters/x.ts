import type { Adapter, ParseResult } from '../types';
import { textOf, visibleText } from '../text';

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;
const CHALLENGE_PATH = /^\/(login|logout|i\/flow\/|account\/access)/;
const PAUSE_TEXT = /rate[- ]limit(ed)?|too many requests|unusual activity/i;
const ERROR_TEXT = /something went wrong|try again|try reloading/i;

function pathOf(href: string | null): string {
  try {
    return new URL(href ?? '', 'https://x.com').pathname;
  } catch {
    return '';
  }
}

/** Quoted posts sit in a div[role=link] inside the outer article. */
function quoteOf(el: Element, article: Element): Element | null {
  const q = el.closest('div[role="link"]');
  return q && q !== article && article.contains(q) ? q : null;
}

function own(article: Element, sel: string): Element | null {
  for (const el of article.querySelectorAll(sel)) if (!quoteOf(el, article)) return el;
  return null;
}

function looksPromoted(article: Element): boolean {
  for (const span of article.querySelectorAll('span')) {
    if (quoteOf(span, article) || span.closest('[data-testid="tweetText"]')) continue;
    const t = span.textContent?.trim();
    if ((t === 'Ad' || t === 'Promoted') && span.children.length === 0) return true;
  }
  return false;
}

/**
 * The For you / Following switch has no URL of its own: find it by label, then by position. The
 * position is only trusted when there are exactly the two tabs; with pinned lists added, a
 * missing tab is reported instead of reading the wrong one under this feed's name.
 */
function feedTab(doc: Document, label: string, index: number): HTMLElement | null {
  const tabs = [...doc.querySelectorAll<HTMLElement>('[data-testid="ScrollSnap-List"] [role="tab"]')];
  return tabs.find(t => t.textContent?.trim() === label) ?? (tabs.length === 2 ? tabs[index] : null);
}

export const X_FEEDS = ['following', 'for-you'] as const;

export const xAdapter: Adapter = {
  site: 'x',
  limits: { maxMs: 90_000, maxPosts: 60 },
  feeds: [
    {
      name: 'following',
      label: 'Following',
      findTab: doc => feedTab(doc, 'Following', 1),
      // Sorted by Popular, X shows only a handful of posts here.
      shortHint: 'if Following is sorted by Popular on X, switch it to Recent',
    },
    { name: 'for-you', label: 'For you', findTab: doc => feedTab(doc, 'For you', 0) },
  ],

  postElements(root) {
    return [...root.querySelectorAll('article[data-testid="tweet"]')];
  },

  parse(article, now): ParseResult {
    if (looksPromoted(article)) return { kind: 'promoted' };

    const time = own(article, 'time');
    const statusLink = time?.closest('a');
    const m = statusLink ? STATUS_PATH.exec(pathOf(statusLink.getAttribute('href'))) : null;
    if (!time || !m) return { kind: 'skip', reason: 'no status link' };
    const [, handle, statusId] = m;

    const userName = own(article, '[data-testid="User-Name"]');
    const name = textOf(userName?.querySelector('a')) || handle;

    const textEl = own(article, '[data-testid="tweetText"]');
    const contextEl = own(article, '[data-testid="socialContext"]');

    let quoted: { author: string; text: string } | null = null;
    const quoteText = [...article.querySelectorAll('[data-testid="tweetText"]')].find(el =>
      quoteOf(el, article),
    );
    if (quoteText) {
      const q = quoteOf(quoteText, article)!;
      const who = textOf(q.querySelector('[data-testid="User-Name"]'));
      const at = /@([A-Za-z0-9_]{1,15})/.exec(who);
      quoted = { author: at ? `@${at[1]}` : who, text: textOf(quoteText) };
    }

    return {
      kind: 'post',
      post: {
        id: `x:${statusId}`,
        site: 'x',
        url: `https://x.com/${handle}/status/${statusId}`,
        author: { name, handle: `@${handle}`, profileUrl: `https://x.com/${handle}` },
        text: textOf(textEl),
        truncated: !!own(article, '[data-testid="tweet-text-show-more-link"]'),
        postedAt: time.getAttribute('datetime'),
        postedAtText: null,
        context: textOf(contextEl) || null,
        quoted,
        feeds: [],
        capturedAt: now.toISOString(),
      },
    };
  },

  detectChallenge(doc, url) {
    if (url.hostname !== 'x.com' && !url.hostname.endsWith('.x.com')) {
      return `left x.com (now on ${url.hostname})`;
    }
    if (CHALLENGE_PATH.test(url.pathname)) return `login or verification page (${url.pathname})`;
    if (doc.querySelector('iframe[src*="arkoselabs"], iframe[src*="captcha"]')) return 'captcha';
    if (doc.querySelector('[data-testid="loginButton"], [data-testid="login"]')) return 'logged out';
    return null;
  },

  detectErrorPage(doc) {
    const text = visibleText(doc.body);
    const pause = PAUSE_TEXT.exec(text);
    if (pause) return { reason: `X showed "${pause[0]}"`, pause: true };
    if (ERROR_TEXT.test(text)) return { reason: 'X showed an error page instead of the feed', pause: false };
    return null;
  },
};
