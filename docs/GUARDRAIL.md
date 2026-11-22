# Viewing guardrail: do product tags hurt watch time?

Partners pay for visibility, but the audience is only worth anything while people keep watching. This measures whether tags cost watch time, and reports the tags → saves → opens → sales funnel per shop.

## How it works
* **Randomized hold-out.** A stable, random share of viewers (default **5%**, `CHIP_HOLDOUT_PCT`, 0–50, `0` turns it off) is shown *no tags* on tagged videos. Assignment is by a salted hash of the session id, so a viewer is always in the same group, raising the percentage only adds people (nobody flips back and forth), and the group can't be guessed from the raw id. Creators always see their own tags. Web embeds/widgets (no session) are never held out.
* **Why not just compare tagged and untagged videos?** Creators choose what to tag, so that comparison is confounded. Comparing exposed vs hold-out viewers *of the same tagged videos* is a controlled experiment; "Untagged videos" is shown for reference only.
* **What the app sends** (`POST /api/events`, batched every ~10 s and when backgrounded): one `watch` event per viewing (milliseconds actually *played*: paused, covered or backgrounded time doesn't count) and one `chip` event the first time a tag appears. Failures are dropped or retried quietly and never affect playback.
* **What the server stores:** only per-video / per-day **sums** per cohort (sessions, completions, total watch time, Σ watch-through, Σ watch-through²), and tag impressions per shop per day. No per-viewer rows. A creator's views of their own videos are excluded; looping is capped at 100%.
* **Verdict** (Admin → Attribution → "Do tags hurt viewing?"): difference in *share of the video watched*, exposed − hold-out, with a 95% range (Welch test). It says **"Tags are reducing watch time"** only when the drop is both statistically significant (p < 0.05) *and* at least 1 point; "no harm" otherwise; and **"Collecting data"** until each group has 200 viewings, rather than guessing.

## If the verdict is "reducing watch time"
Show fewer tags at once, shorten their windows (the product is only relevant while it's on screen), review the videos with the most tags, and re-check after a week.

## Trade-off
The hold-out means about 5% of viewers don't see tags, which costs a small amount of tag exposure. That is the price of a trustworthy answer; set `CHIP_HOLDOUT_PCT=0` to stop the experiment (the verdict then stops updating).

## Privacy
Aggregates only; nothing here identifies a viewer. Mention viewing/engagement analytics in your privacy policy.
