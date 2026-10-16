import type { Adapter, ParseResult } from '../types';
import { first, textOf, visibleText } from '../text';

/** Current layout (2026): coded class names, no post ids. A post is the feed item with a post menu. */
const FEED_ITEM = '[data-testid="mainFeed"] > *';
const POST_MENU = '[aria-label^="Open control menu for post by "]';
const TEXT_BOX = '[data-testid="expandable-text-box"]';
const MORE_BUTTON = '[data-testid="expandable-text-button"]';
/** "Sam Lee likes this", "… reposted this", "… commented on this", "… finds this insightful". */
const CONTEXT_VERB = /\b(likes|loves|celebrates|supports|reposted|commented on|finds|is curious about)\b.*\bthis\b/i;
/** "12h", "3d", "2w", "1mo", "Yesterday", alone or between bullets: "with Ana • 12h • Edited". */
const POSTED = /(?:^|•\s*)(\d+\s?(?:s|m|h|d|w|mo|yr|y)|Yesterday|Just now)(?=\s*(?:•|$))/i;

/** Layout used until 2026, still served to some accounts. */
const POST_SEL = [
  '[data-urn^="urn:li:activity:"]',
  '[data-id^="urn:li:activity:"]',
  '[data-urn^="urn:li:aggregate:"]',
  '[data-id^="urn:li:aggregate:"]',
].join(', ');
const CHALLENGE_PATH = /^\/(checkpoint|authwall|login|uas\/|signup)/;
const PAUSE_TEXT = /too many requests|security check|security verification|unusual activity/i;
const ERROR_TEXT = /something went wrong|try again/i;
const PROFILE_HREF = 'a[href*="/in/"], a[href*="/company/"], a[href*="/school/"], a[href*="/showcase/"]';

/** LinkedIn repeats text in .visually-hidden spans for screen readers; buttons hold "…more". */
const skip = (el: Element) =>
  el.classList.contains('visually-hidden') || el.tagName === 'BUTTON';

/** Stable id for a post the page gives no id for: same author and text, same id on every run. */
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Where to read a post with no permalink: the author's recent activity. */
function activityUrl(profileUrl: string): string {
  if (!profileUrl) return 'https://www.linkedin.com/feed/';
  return /\/in\//.test(profileUrl) ? `${profileUrl}recent-activity/all/` : `${profileUrl}posts/`;
}

function parseCurrent(el: Element, menu: Element, now: Date): ParseResult {
  const name = (menu.getAttribute('aria-label') ?? '').replace(/^Open control menu for post by /, '').trim();
  if (!name) return { kind: 'skip', reason: 'no author' };
  const textBox = el.querySelector(TEXT_BOX);
  const outside = (n: Element) => !textBox?.contains(n);

  const leaves = [...el.querySelectorAll('span, p')].filter(n => outside(n) && n.children.length === 0);
  if (leaves.some(n => textOf(n) === 'Promoted')) return { kind: 'promoted' };

  // The author's link names them; the header's link names whoever liked or reposted it.
  const link = [...el.querySelectorAll<HTMLAnchorElement>(PROFILE_HREF)].find(a =>
    outside(a) && (textOf(a, skip).includes(name) || (a.getAttribute('aria-label') ?? '').includes(name)));
  const profile = cleanProfile(link?.getAttribute('href') ?? null);

  const verb = leaves.find(n => CONTEXT_VERB.test(textOf(n)));
  const who = verb?.parentElement ? textOf(verb.parentElement.querySelector('a, strong'), skip) : '';
  const said = verb ? textOf(verb) : '';
  const context = !verb ? null : who && !said.includes(who) ? `${who} ${said}` : said;

  let postedAtText: string | null = null;
  for (const n of leaves) {
    const m = POSTED.exec(textOf(n));
    if (m) { postedAtText = m[1]; break; }
  }

  const text = textOf(textBox, skip);
  return {
    kind: 'post',
    post: {
      id: `linkedin:h${hashId(`${profile.handle || name}|${text.slice(0, 300)}`)}`,
      site: 'linkedin',
      url: activityUrl(profile.url),
      author: { name, handle: profile.handle, profileUrl: profile.url },
      text,
      truncated: !!el.querySelector(MORE_BUTTON),
      postedAt: null,
      postedAtText,
      context,
      quoted: null,
      feeds: [],
      capturedAt: now.toISOString(),
    },
  };
}

function cleanProfile(href: string | null): { url: string; handle: string } {
  try {
    const u = new URL(href ?? '', 'https://www.linkedin.com');
    const m = /^\/(in|company|school|showcase)\/([^/]+)/.exec(u.pathname);
    if (!m) return { url: '', handle: '' };
    return { url: `https://www.linkedin.com/${m[1]}/${m[2]}/`, handle: decodeURIComponent(m[2]) };
  } catch {
    return { url: '', handle: '' };
  }
}

export const linkedinAdapter: Adapter = {
  site: 'linkedin',
  limits: { maxMs: 60_000, maxPosts: 30 },

  scrollContainer: doc => doc.querySelector('main#workspace'),

  postElements(root) {
    const current = new Set<Element>();
    for (const menu of root.querySelectorAll(POST_MENU)) {
      const item = menu.closest(FEED_ITEM);
      if (item) current.add(item);
    }
    if (current.size) return [...current];
    return [...root.querySelectorAll(POST_SEL)].filter(el => !el.parentElement?.closest(POST_SEL));
  },

  parse(el, now): ParseResult {
    const menu = el.querySelector(POST_MENU);
    if (menu) return parseCurrent(el, menu, now);

    const urn =
      el.getAttribute('data-urn') ??
      el.getAttribute('data-id') ??
      el.querySelector('[data-urn]')?.getAttribute('data-urn');
    if (!urn) return { kind: 'skip', reason: 'no urn' };

    const actor = first(el, ['.update-components-actor', '.feed-shared-actor']) ?? el;
    const sub = first(actor, [
      '.update-components-actor__sub-description',
      '.feed-shared-actor__sub-description',
    ]);
    const desc = first(actor, [
      '.update-components-actor__description',
      '.feed-shared-actor__description',
    ]);
    if (/\bpromoted\b/i.test(`${textOf(sub, skip)} ${textOf(desc, skip)}`)) {
      return { kind: 'promoted' };
    }

    const nameEl = first(actor, [
      '.update-components-actor__title span[aria-hidden="true"]',
      '.update-components-actor__name',
      '.update-components-actor__title',
      '.feed-shared-actor__name',
    ]);
    const name = textOf(nameEl, skip).split(/\s+•\s+/)[0].trim();
    const profile = cleanProfile(actor.querySelector(PROFILE_HREF)?.getAttribute('href') ?? null);

    const textEl = first(el, [
      '.update-components-text',
      '.feed-shared-update-v2__description',
      '.feed-shared-inline-show-more-text',
      '.feed-shared-text',
    ]);
    const text = textOf(textEl, skip);
    if (!name && !text) return { kind: 'skip', reason: 'no author or text' };

    const postedAtText = textOf(sub, skip).split('•')[0].trim() || null;
    const contextEl = first(el, [
      '.update-components-header__text-view',
      '.update-components-header',
      '.feed-shared-header',
    ]);

    return {
      kind: 'post',
      post: {
        id: `linkedin:${urn}`,
        site: 'linkedin',
        url: `https://www.linkedin.com/feed/update/${urn}/`,
        author: { name: name || profile.handle, handle: profile.handle, profileUrl: profile.url },
        text,
        truncated: !!el.querySelector(
          '.feed-shared-inline-show-more-text__see-more-less-toggle, button.see-more',
        ),
        postedAt: null,
        postedAtText,
        context: textOf(contextEl, skip) || null,
        quoted: null,
        feeds: [],
        capturedAt: now.toISOString(),
      },
    };
  },

  detectChallenge(doc, url) {
    if (!url.hostname.endsWith('linkedin.com')) return `left linkedin.com (now on ${url.hostname})`;
    if (CHALLENGE_PATH.test(url.pathname)) return `login or verification page (${url.pathname})`;
    if (doc.querySelector('iframe[src*="captcha"], iframe[src*="arkoselabs"], #captcha-internal')) {
      return 'captcha';
    }
    if (doc.querySelector('input#username') && doc.querySelector('input#password')) {
      return 'login form';
    }
    return null;
  },

  detectErrorPage(doc) {
    const text = visibleText(doc.body);
    const pause = PAUSE_TEXT.exec(text);
    if (pause) return { reason: `LinkedIn showed "${pause[0]}"`, pause: true };
    if (ERROR_TEXT.test(text)) return { reason: 'LinkedIn showed an error page instead of the feed', pause: false };
    return null;
  },
};
