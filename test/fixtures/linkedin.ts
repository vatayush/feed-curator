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
