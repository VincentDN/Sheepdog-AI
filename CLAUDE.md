# Notes for Claude Code

## What this is

Sheepdog types a message into a browser AI chat on a schedule. Three parts that have
to agree with each other:

- `service/` — Node, one dependency (`ws`). Owns the schedule, hosts the control
  panel, exposes REST + WebSocket. Entry point `service/src/index.js`.
- `extension/` — Chrome MV3. Holds a WebSocket to the service, finds the tab, does
  the typing. No build step; load unpacked.
- `service/public/` — the control panel. Vanilla JS, no framework, no bundler. Also
  the Android app, via PWA install.

There is no build pipeline anywhere. Edit a file, restart the service or reload the
extension. Keep it that way.

## The thing that will break

Claude and ChatGPT rewrite their markup regularly. When nudges start failing with
"couldn't find the message box", the fix is `extension/selectors.js` and nothing
else. Every site-specific string lives there, in ordered fallback lists. Add the new
selector to the front of the relevant list. Do not scatter selectors into
`content.js`.

## Design rules worth not breaking

- **Restraint over reliability.** A missed nudge is cheap; an interrupted agent or a
  clobbered draft is not. `reasonToHoldOff()` in `content.js` is the gate, and it
  should stay biased toward holding off.
- **Failures don't reset the clock.** In `scheduler.js`, only `sent` and `skipped`
  update `lastRunAt`. A failure retries on the next tick rather than going quiet for
  a whole interval. This is deliberate.
- **The per-hour cap is a safety rail, not a preference.** Scheduled nudges respect
  it; manual ones from the panel bypass it, because a human asked.
- **Skips don't count against the cap.** Only real sends do.
- **The service is the only source of truth.** The panel renders server state and
  holds exactly one piece of local state: an unsaved new-agent draft. Don't grow that.

## Protocol between service and extension

Service sends `{type:'nudge', id, target}`. Extension replies
`{type:'result', id, ok, status, detail}` where status is `sent`, `skipped` or
`failed`. `detail` is shown to the user verbatim in the log, so write it as a
sentence a person would want to read, not an error code.

## Local data

`%APPDATA%\Sheepdog\config.json` holds the flock and the access code. It is
gitignored. Never commit one.
