/** Trimmed copies of LinkedIn's feed markup: only the classes the adapter relies on. */
export const post = (urn: string, name: string, slug: string, text: string, opts: { sub?: string; header?: string; more?: boolean } = {}) => `
<div data-id="urn:li:activity:${urn}" class="feed-shared-update-v2">
  ${opts.header ? `<div class="update-components-header"><span class="update-components-header__text-view">${opts.header}</span></div>` : ''}
  <div class="update-components-actor">
    <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/${slug}?miniProfileUrn=abc">
      <span class="update-components-actor__title">
        <span aria-hidden="true">${name}</span><span class="visually-hidden">${name}</span>
      </span>
      <span class="update-components-actor__description"><span aria-hidden="true">Engineer at Startup</span></span>
      <span class="update-components-actor__sub-description"><span aria-hidden="true">${opts.sub ?? '3h • Edited •'}</span><span class="visually-hidden">3 hours ago</span></span>
    </a>
  </div>
  <div class="feed-shared-update-v2__description">
    <div class="feed-shared-inline-show-more-text">
      <span class="break-words"><span dir="ltr">${text}</span></span>
      ${opts.more ? '<button class="feed-shared-inline-show-more-text__see-more-less-toggle">…more</button>' : ''}
    </div>
  </div>
</div>`;

/**
 * The current layout (2026), trimmed: coded class names left out, since the adapter only relies on
 * the post menu's label, test ids, links and text. Mirrors a real feed item's nesting.
 */
export const currentPost = (
  name: string,
  slug: string,
  text: string,
  opts: { liker?: string; promoted?: boolean; time?: string; more?: boolean; company?: boolean } = {},
) => `
<div data-lazy-mount-id="x">
  <span class="visually-hidden">Feed post</span>
  ${opts.liker ? `<div aria-hidden="true"><a href="https://www.linkedin.com/in/liker/"></a>
    <p><span>likes this</span><a aria-label="View ${opts.liker}’s profile" href="https://www.linkedin.com/in/liker/"><strong>${opts.liker}</strong></a></p></div>` : ''}
  <button aria-label="Open control menu for post by ${name}"><svg aria-hidden="true"></svg></button>
  <button aria-label="Hide post by ${name}"><svg aria-hidden="true"></svg></button>
  <a href="https://www.linkedin.com/${opts.company ? 'company' : 'in'}/${slug}/?trk=feed"><svg aria-label="View ${name}’s profile"></svg></a>
  <a href="https://www.linkedin.com/${opts.company ? 'company' : 'in'}/${slug}/?trk=feed">
    <div aria-label="${name} Premium Profile 3rd"><p><span>${name}</span></p><p><span>• 3rd</span></p></div>
  </a>
  <p><span>Engineering Leader | Storage</span></p>
  <p><span>${opts.promoted ? 'Promoted' : opts.time ?? 'with Ana Ruiz • 12h • Edited'}</span></p>
  <button aria-label="Follow ${name}"><span>Follow</span></button>
  <p><span data-testid="expandable-text-box">${text}</span></p>
  ${opts.more ? '<button data-testid="expandable-text-button">… more</button>' : ''}
  <a href="https://www.linkedin.com/feed/"></a>
  <button aria-label="Reaction button state: no reaction"><span>132</span></button>
</div>`;

export const currentFeed = (...items: string[]) => `
<main id="workspace"><div data-testid="mainFeed">
  <div data-lazy-mount-id="a">Start a post</div>
  <div data-lazy-mount-id="b">Sort by: Top</div>
  <div data-lazy-mount-id="c">Recommended for you <a href="https://www.linkedin.com/in/someone/">Someone</a> <button>Follow</button></div>
  ${items.join('')}
</div></main>`;
