# Sheepdog

Sheepdog nudges your AI agents. It watches Claude and ChatGPT conversations you've
told it about, and at the times you choose it types a message — "resume the work"
by default — into the chat and sends it.

It's a sheepdog rather than a timer because it checks before it acts. If the agent
is still generating, if the page is still moving, or if you have a half-typed draft
in the box, it holds off and says so in the log.

## The three pieces

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Service | Windows, in the background | Holds the schedule, decides when each agent is due, keeps the log |
| Extension | Chrome or Edge, same machine | Finds the right tab and does the typing |
| Control panel | Any browser on your network, including your phone | Add agents, change schedules, nudge on demand, stop everything |

The control panel is a web app the service hosts. On Android, open it in Chrome and
choose "Add to Home screen" — it installs as a standalone app with its own icon.

### Why the phone isn't doing the typing

Android and iOS won't let one app type into another app's web page, and nothing on
your phone can reach into a browser on your PC. So the phone is a remote control:
the Windows machine does the work, the phone tells it what to do and shows what
happened. That's the only arrangement that actually works.

## Setting it up

**1. Start the service**

Install [Node.js](https://nodejs.org) if you don't have it, then run:

```
windows\start-sheepdog.cmd
```

It prints a control panel link and an access code. Keep that window open the first time.

**2. Load the extension**

In Chrome or Edge, go to `chrome://extensions`, turn on Developer mode, choose
"Load unpacked" and pick the `extension` folder. Click the Sheepdog icon, paste the
access code, and save. The dot turns green when it connects.

**3. Open the control panel**

Click the link the service printed. Add an agent: pick one of your open chat tabs
from the dropdown, set how often, save.

**4. Make it permanent**

```
powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1
```

This starts Sheepdog when you sign in and opens its port on your private network so
your phone can reach it. Undo it with the same command plus `-Remove`.

## Using it from your phone

Both devices need to be on the same network, or on the same Tailscale/VPN. Open
`http://<your-pc-name-or-ip>:8787/` in Chrome on Android, paste the access code once,
then add it to your home screen.

## What each setting does

- **Tab address** — the conversation URL. A `*` stands in for anything, so
  `https://claude.ai/chat/*` matches whichever Claude chat is open.
- **What to type** — the message. Default is `resume the work`.
- **When** — either a gap in minutes, or fixed times of day.
- **Days** — which days of the week the schedule applies.
- **Quiet from / until** — a window where nothing is sent. Crossing midnight is fine.
- **Only nudge when the agent has gone quiet** — the restraint switch. Leave it on.
- **Quiet for at least** — how long the page must sit still before that counts.
- **Most nudges per hour** — a hard ceiling, so a misconfigured schedule can't run away.

Manual nudges from the panel ignore the quiet-period check, since you're the one
deciding. They still won't overwrite a draft or interrupt a generating response.

## Where things live

Settings and the log go in `%APPDATA%\Sheepdog`. Point `SHEEPDOG_DATA` somewhere
else if you'd rather. Losing that folder just means a new access code and an empty flock.

Sheepdog listens on port 8787. If something else already has it, set `SHEEPDOG_PORT`
to another number before starting. Launching a second copy by mistake is harmless —
it tells you the port is taken and stops.

## When it stops working

Claude and ChatGPT rewrite their markup regularly, and when they do the extension
will start logging "couldn't find the message box". Everything site-specific lives in
`extension/selectors.js`. Open the chat, inspect the composer, add the new selector to
the top of the relevant list, and reload the extension. Nothing else needs touching.

## Worth knowing

- The access code is the only thing protecting the panel, and the service listens on
  your whole local network so your phone can reach it. That's fine on a home network.
  Don't port-forward it to the internet — use Tailscale or a VPN if you need it from
  outside.
- Automating a provider's web interface sits awkwardly against most AI providers'
  terms of use, and an agent nudged on a fixed cadence burns through usage limits
  faster than you'd expect. The per-hour cap and the idle check exist partly for that
  reason. Keep them tight.
- Chrome suspends extension background workers aggressively. Sheepdog reconnects on a
  30-second alarm, so a nudge may land up to half a minute late after a long idle
  stretch. If a tab has been discarded, Sheepdog reloads it first and reports the delay.
