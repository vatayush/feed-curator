/** Trimmed copies of X's feed markup: only the attributes the adapter relies on. */
export const tweet = (id: string, handle: string, name: string, text: string, extra = '') => `
<article data-testid="tweet" role="article">
  ${extra}
  <div data-testid="User-Name">
    <a href="/${handle}" role="link"><span>${name}</span></a>
    <a href="/${handle}" role="link"><span>@${handle}</span></a>
    <a href="/${handle}/status/${id}" role="link"><time datetime="2026-10-15T14:03:00.000Z">2h</time></a>
  </div>
  <div data-testid="tweetText" lang="en"><span>${text}</span></div>
</article>`;

export const repostContext = (who: string) =>
  `<div><span data-testid="socialContext">${who} reposted</span></div>`;

export const withQuote = `
<article data-testid="tweet" role="article">
  <div data-testid="User-Name">
    <a href="/sam" role="link"><span>Sam Lee</span></a>
    <a href="/sam/status/111" role="link"><time datetime="2026-10-15T10:00:00.000Z">6h</time></a>
  </div>
  <div data-testid="tweetText"><span>This is the right take </span><img alt="👇" src="x.png"></div>
  <div data-testid="tweet-text-show-more-link">Show more</div>
  <div role="link" tabindex="0">
    <div data-testid="User-Name"><span>Pat Kim</span><span>@patk</span><span>·</span><time datetime="2026-10-14T09:00:00.000Z">Oct 14</time></div>
    <div data-testid="tweetText"><span>Small teams ship faster.<br>Fight me.</span></div>
  </div>
</article>`;

export const ad = `
<article data-testid="tweet" role="article">
  <div data-testid="User-Name">
    <a href="/bigbrand" role="link"><span>Big Brand</span></a>
    <span>Ad</span>
  </div>
  <div data-testid="tweetText"><span>Buy our AI thing</span></div>
</article>`;
