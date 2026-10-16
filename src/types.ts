export type Site = 'x' | 'linkedin';

export interface Post {
  /** Stable across runs: `x:<status id>` or `linkedin:<activity urn>`. */
  id: string;
  site: Site;
  url: string;
  author: { name: string; handle: string; profileUrl: string };
  text: string;
  /** The site cut the text off behind a "Show more" control. */
  truncated: boolean;
  /** ISO timestamp when the site gives one (X), else null. */
  postedAt: string | null;
  /** The site's own wording, e.g. "3h" on LinkedIn. */
  postedAtText: string | null;
  /** Why it's in your feed, e.g. "Jane reposted" or "Sam likes this". */
  context: string | null;
  quoted: { author: string; text: string } | null;
  /** Feed tabs it appeared in, e.g. ["following", "for-you"]; ["feed"] on sites without tabs. */
  feeds: string[];
  capturedAt: string;
}

export type RunStatus =
  | 'ok' // posts captured
  | 'no_posts' // page loaded but nothing parsed: the adapter likely needs updating
  | 'stopped' // login, captcha or rate-limit page seen; site is now paused
  | 'paused' // site still paused from an earlier stop; the site was not visited
  | 'disabled'; // site turned off in settings (LinkedIn by default); not visited

export interface RunFile {
  version: 1;
  site: Site;
  startedAt: string;
  finishedAt: string;
  status: RunStatus;
  /** Why the run ended or didn't start, in plain words. */
  reason: string;
  pageUrl: string;
  postCount: number;
  skippedPromoted: number;
  /** Per feed tab, in the order read. Absent on sites without tabs. */
  feeds?: FeedResult[];
  /** How the page behaved, for debugging short runs. */
  diagnostics?: { scrolls: number; start: PageState; end: PageState };
  posts: Post[];
}

export interface FeedResult {
  name: string;
  postCount: number;
  reason: string;
}

/** A tab within one feed page, e.g. X's "For you" and "Following". */
export interface FeedTab {
  name: string;
  label: string;
  findTab(doc: Document): HTMLElement | null;
  /** Added to the reason when this tab runs out early (under half the post cap). */
  shortHint?: string;
}

export interface PageState {
  visibility: string;
  scrollY: number;
  scrollHeight: number;
  innerHeight: number;
}

export type ParseResult =
  | { kind: 'post'; post: Post }
  | { kind: 'promoted' }
  | { kind: 'skip'; reason: string };

export interface Adapter {
  site: Site;
  /** Caps per feed tab. */
  limits: { maxMs: number; maxPosts: number };
  /** Tabs the feed page offers, if any. Default order doesn't matter: the opened tab is read last. */
  feeds?: FeedTab[];
  /** Elements that each hold one post, outermost only. */
  postElements(root: ParentNode): Element[];
  parse(el: Element, now: Date): ParseResult;
  /** The element the feed scrolls in, when it isn't the page itself. */
  scrollContainer?(doc: Document): Element | null;
  /** A reason if the page is a login, captcha or logged-out page; else null. Checked throughout. */
  detectChallenge(doc: Document, url: URL): string | null;
  /**
   * Only consulted when no posts appeared within the first wait. Reads visible text, since sites
   * ship hidden fallback error messages in every page. `pause` = a clear rate-limit or security
   * signal; anything vaguer is reported without pausing.
   */
  detectErrorPage(doc: Document): { reason: string; pause: boolean } | null;
}

/** Plain feed URLs: nothing in them marks a visit as a run. */
export const FEED_URLS: Record<Site, string> = {
  x: 'https://x.com/home',
  linkedin: 'https://www.linkedin.com/feed/',
};

export const SITES: Site[] = ['x', 'linkedin'];
