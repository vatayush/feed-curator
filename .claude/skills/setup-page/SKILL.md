---
name: setup-page
description: Create the reader's own Feed Curator page (the artifact that holds preferences, votes and the digest) and save its link in config.json. Run once by install.sh, or when asked to set up or recreate the Feed Curator page.
---

1. Read `config.json` in the project folder (copy `config.example.json` to it if it's missing).
   If `artifactUrl` is already set, say so and stop, unless the user asked to recreate the page.
2. Publish `artifact/feed-curator.html` with the Artifact tool as a new artifact:
   - capabilities `{"db": {}, "downloads": true}`
   - icon `news`
   - description "Your curated X and LinkedIn digest, with preferences and votes that teach it what you want."

   Publish the file as it is; don't edit it. Its database starts empty, which is correct.
3. Set `artifactUrl` in `config.json` to the URL the publish returned, keeping every other field.
4. Tell the user, in a few lines:
   - the link to their page
   - that preferences start empty: add a few on the page's **Preferences** tab, e.g. what they
     want more of and what they never want to see
   - that votes (👍/👎) on the digest teach it too
