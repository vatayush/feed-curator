import type { Message } from '../messages';
import { isValidTime } from '../schedule';
import { loadState, saveState, type State } from '../storage';
import type { Site } from '../types';

const LABELS: Record<Site, string> = { x: 'X', linkedin: 'LinkedIn' };

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

function render(state: State) {
  const root = document.getElementById('sites')!;
  root.replaceChildren();
  for (const site of ['x', 'linkedin'] as Site[]) {
    const last = state.lastRun[site];
    const paused = (state.pausedUntil[site] ?? 0) > Date.now();
    const status = paused ? 'paused' : last?.status ?? 'none';
    const statusText = paused
      ? `paused until ${new Date(state.pausedUntil[site]!).toLocaleString()}`
      : last ? `${last.status.replace('_', ' ')} · ${last.postCount} posts · ${ago(last.finishedAt)}` : 'no runs yet';

    const actions = el('div', { className: 'actions' });
    const runBtn = el('button', { textContent: `Run ${LABELS[site]} now` });
    runBtn.onclick = () => {
      const msg: Message = { type: 'begin-run', site, manual: true };
      chrome.runtime.sendMessage(msg).catch(() => {}); // the popup may close first
      runBtn.textContent = 'Running…';
      runBtn.disabled = true;
    };
    actions.append(runBtn);
    if (paused) {
      const clear = el('button', { textContent: 'Clear pause' });
      clear.onclick = async () => {
        const s = await loadState();
        delete s.pausedUntil[site];
        await saveState({ pausedUntil: s.pausedUntil });
        render(await loadState());
      };
      actions.append(clear);
    }

    root.append(
      el('section', {},
        el('div', { className: 'row' },
          el('span', { className: 'site', textContent: LABELS[site] }),
          el('span', { className: `status ${status}`, textContent: statusText }),
        ),
        ...(last?.reason ? [el('div', { className: 'detail', textContent: last.reason })] : []),
        ...(last ? [el('div', { className: 'detail', textContent: last.filename.replace(/^\/Users\/[^/]+/, '~') })] : []),
        actions,
      ),
    );
  }

  state.settings.runTimes.forEach((time, i) => {
    const input = document.getElementById(`time${i}`) as HTMLInputElement | null;
    if (!input) return;
    input.value = time;
    input.onchange = async () => {
      if (!isValidTime(input.value)) return;
      const s = await loadState();
      s.settings.runTimes[i] = input.value;
      await saveState({ settings: s.settings });
    };
  });

  for (const box of document.querySelectorAll<HTMLInputElement>('input[data-xfeed]')) {
    const feed = box.dataset.xfeed!;
    box.checked = state.settings.xFeeds.includes(feed);
    box.onchange = async () => {
      const s = await loadState();
      const others = s.settings.xFeeds.filter(f => f !== feed);
      // Keep the read order fixed: Following, then For you.
      s.settings.xFeeds = ['following', 'for-you'].filter(f => (f === feed ? box.checked : others.includes(f)));
      await saveState({ settings: s.settings });
    };
  }

  for (const key of ['linkedinEnabled', 'closeTabAfterRun'] as const) {
    const box = document.getElementById(key) as HTMLInputElement;
    box.checked = state.settings[key];
    box.onchange = async () => {
      const s = await loadState();
      s.settings[key] = box.checked;
      await saveState({ settings: s.settings });
    };
  }
}

loadState().then(render);
chrome.storage.onChanged.addListener(() => loadState().then(render));
