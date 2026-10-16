import type { Adapter, ParseResult } from '../types';
import { first, textOf, visibleText } from '../text';

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

  postElements(root) {
    return [...root.querySelectorAll(POST_SEL)].filter(el => !el.parentElement?.closest(POST_SEL));
  },

  parse(el, now): ParseResult {
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
