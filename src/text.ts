/**
 * Visible text of a node: emoji images become their alt text, <br> becomes a newline,
 * and anything `skip` matches (screen-reader duplicates, buttons) is left out.
 * Works in jsdom, which has no innerText.
 */
export function textOf(node: Node | null | undefined, skip?: (el: Element) => boolean): string {
  if (!node) return '';
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (skip?.(el)) return;
    switch (el.tagName) {
      case 'BR':
        out += '\n';
        return;
      case 'IMG':
        out += el.getAttribute('alt') ?? '';
        return;
      case 'SCRIPT':
      case 'STYLE':
        return;
    }
    for (const child of el.childNodes) walk(child);
  };
  walk(node);
  return out
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function first(root: ParentNode | null | undefined, selectors: string[]): Element | null {
  if (!root) return null;
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** Rendered text only: hidden fallback messages are left out. jsdom has no innerText, so tests fall back. */
export function visibleText(el: HTMLElement | null | undefined): string {
  if (!el) return '';
  return el.innerText ?? el.textContent ?? '';
}
