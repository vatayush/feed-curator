# Feed Curator

Read X (and optionally LinkedIn) without opening them. A Chrome extension reads your feeds twice a
day in your own browser, Claude Code scores every post against what you've said you want, and you
read the few that matter on a private page on claude.ai, on your computer or phone. Vote 👍/👎
and it learns.

It only reads. It never posts, likes, follows or replies.

> **Know the risk.** Automated reading of X, even in your own logged-in browser, may break X's
> terms of service, and X could limit or suspend your account. Feed Curator reads slowly, at most
> twice a day, and stops for 48 hours at any login, captcha or rate-limit page, but the risk is
> yours. LinkedIn is off by default for the same reason.

## Install

Needs macOS, Google Chrome and [Claude Code](https://claude.com/claude-code).

```sh
curl -fsSL https://raw.githubusercontent.com/vatayush/feed-curator/main/install.sh | bash
```

The installer:

1. downloads Feed Curator into `~/feed-curator` (choose another folder with `bash -s -- --dir <path>`)
2. registers the small helper that saves captures, with Chrome
3. asks whether Claude may curate automatically after each capture (see [Permissions](#permissions))
4. opens Claude Code once to create **your own** Feed Curator page on claude.ai
5. opens the extension folder for the one step Chrome doesn't allow from a script: on
   `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose
   `~/feed-curator/dist`

Then press **Run X now** in the extension's popup to try it.

Update by running the same command again. Uninstall with `bash ~/feed-curator/install.sh --uninstall`.

## How it works

```
07:45  Chrome extension reads X → captures/x-latest.json   (helper saves it)
       helper starts a Terminal → claude "/curate"         (if automatic curation is on)
       Claude scores the posts → your page's digest         (claude.ai)
```

- **Capture.** At 07:45 and 17:45 the extension opens a background tab on the plain feed URL,
  scrolls the **Following** and **For you** tabs (up to 60 posts or 90 s each), and closes it.
  Chrome must be open and you logged in to X. A run more than an hour late is skipped. Sort
  **Following** by **Recent** on X: sorted by Popular, it shows only a handful of posts.
- **Curate.** The helper starts `com.feedcurator.curate`, an on-demand launchd job (no schedule)
  that opens a Terminal window running Claude Code: macOS doesn't let Chrome open Terminal itself.
  Claude Code applies your hard rules (always show, always hide, blocked words),
  scores the rest from 0 to 1 against your preferences and votes, and publishes the digest. Posts
  scoring 0.6 or more are shown; the rest are on the **Dropped** tab with Claude's reason.
- **Read.** Your page is private to you on claude.ai and works in the Claude app on your phone.

Curate by hand any time: open Claude Code in `~/feed-curator` and type `/curate`.

## Settings

| Where | What |
|---|---|
| Your Feed Curator page | preferences in plain words, people to always show or hide, blocked words, the score threshold, votes |
| The extension's popup | capture times, which X feeds, LinkedIn on/off, run now, clear a pause |
| `~/feed-curator/config.json` | `topics` the digest is grouped by, `about` (a note on what you want and how to judge it), `autoCurate` |

Everything starts empty: add a few preferences on the page, then vote on the digest.

## Permissions

Automatic curation runs Claude Code unattended, so `.claude/settings.json` approves exactly what
a run needs, and only for sessions in the Feed Curator folder:

- reading your page's data and writing its digest. `curate/guard_artifact.py` blocks everything
  else, including any other artifact, since posts are written by strangers and could try to talk
  Claude into something else
- running `curate/prepare.py` and `curate/apply.py`, and writing in `work/`

Anything else stops at a permission prompt. A run ends and closes its window when the digest is
published (a Stop hook, `curate/end_auto_run.py`, that only acts in these runs), or after 15 minutes
at the latest. Turn
automatic curation off with `"autoCurate": false` in `config.json`.

## Privacy

Captures stay on your Mac in `~/feed-curator/captures` (30 days). Claude reads them during
curation, and the digest is stored on your private page on claude.ai. Nothing is sent anywhere else.

## Safety stops

A login page, captcha, logged-out page, or rate-limit or security-check page stops the run at
once, leaves the tab open so you can see it, and pauses that site for **48 hours**. Clear the
pause in the popup, or press **Run X now**.

## Develop

```sh
npm install
npm test             # parsing, safety stops, feed tabs, schedule
npm run build        # writes dist/; reload the extension on chrome://extensions
```

- `src/`: the extension. Each site's selectors live in `src/adapters/<site>.ts`. If a run says
  `no_posts`, the site's markup probably changed there.
- `host/`: the native messaging helper that saves captures and starts curation.
- `curate/`: the curation steps (`CURATION.md`), `prepare.py` → Claude's scores → `apply.py`.
- `artifact/feed-curator.html`: the page.

Install from a checkout with `bash install.sh --from-source`. Tagging `v*` publishes the extension
build that `install.sh` downloads.

## License

MIT
