# Sheepdog

Sheepdog nudges your AI agents. It watches Claude and ChatGPT conversations you've
told it about, and at the times you choose it types a message — "resume the work"
by default — into the chat and sends it.

It's a sheepdog rather than a timer because it checks before it acts. If the agent
is still generating, if the page is still moving, or if you have a half-typed draft
in the box, it holds off and says so in the log.

## The pieces

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Service | Windows, in the background | Holds the schedule, decides when each agent is due, keeps the log |
| Extension | Chrome or Edge, same machine | Finds the right tab and does the typing |
| Control panel | Any browser on your network, including your phone | Add agents, change schedules, nudge on demand, stop everything |
| Discord bot | Part of the service, optional | Turns `@Sheepdog <task>` in a Discord channel into a roadmap entry |

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

## Logging tasks from Discord

Add Sheepdog to a Discord server and tag it in any channel it's in — `@Sheepdog
fix the header bug`, with a screenshot attached if you like — and it writes that
as a task line onto today's roadmap file. Tag it again for the next task, and
the next, all day; they pile up in the same file. Ask it to work through them at
the time your agent's usage limit refreshes, and it can check off what's done
and pick up where it left off.

**1. Create the bot**

In the [Discord Developer Portal](https://discord.com/developers/applications),
make a new application, open **Bot**, turn on the **Message Content Intent**,
and copy the token. Under **OAuth2 → URL Generator**, tick the `bot` scope and
the `Send Messages` + `Read Message History` permissions, then open the
generated URL to invite it to your server.

**2. Give the service the token**

Set an environment variable before starting the service, e.g. in
`windows\start-sheepdog.cmd` or your own shortcut:

```
set SHEEPDOG_DISCORD_TOKEN=your-bot-token-here
node src\index.js
```

Without this variable set, the service runs exactly as before — the Discord
piece is entirely optional. When it is set, the console prints `Discord:
connected as <bot name>` once it's logged in.

**3. Tag it to add tasks**

Each mention becomes one line in `<data folder>/roadmaps/Sheepdog-Roadmap-
<today's date>.md` — a markdown checkbox with who asked and when, plus the
image if you attached or linked one. The bot replies in the channel to confirm.
A new day starts a new file.

**4. Point an agent at it**

The roadmap is readable over the same API the control panel uses:

```
GET http://<your-pc>:8787/api/roadmap/latest?token=<your access code>
GET http://<your-pc>:8787/api/roadmap/<filename>?token=<your access code>
GET http://<your-pc>:8787/api/roadmap?token=<your access code>   # lists files
```

Tell your agent (in its system prompt, project instructions, or however it
takes standing context) to fetch that URL when asked to resume. Then set that
agent's flock entry message to something like:

```
I am Sheepdog, bark bark. Resume the work with the following prompt - check
which tasks are already completed and continue the work until the end of the
roadmap is reached. If the end is reached, do nothing.
```

with fixed times matching when its usage limit refreshes. No code changes
needed for this part — the message field is already free text.

Note: the image link Discord gives an attachment expires after a while, so
it's meant for an agent that checks in reasonably soon, not a permanent
archive.

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
