> **DEPRECATED (23 Nov 2026).** Sheepdog is now a Discord bot that ingests staged prompts from a specific chat channel and delivers them to a repo. Woof Woof! It lives in [`VincentDN/vdn-internal`, `tools/sheepdog/`](https://github.com/VincentDN/vdn-internal/tree/main/tools/sheepdog) once merged. This Windows nudge app is no longer maintained; do not build on it.

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

## Installing it properly

This walks through every piece, in the order that makes each next step work.
Skip step 2 if you don't need Sheepdog typing into a Claude/ChatGPT tab — the
Discord + roadmap side works fine on its own.

### 1. Start the service

Install [Node.js](https://nodejs.org) if you don't have it, then run:

```
windows\start-sheepdog.cmd
```

It prints a control panel link and an access code. Keep that window open the
first time — everything else in this guide talks to this process.

### 2. Load the extension (optional)

Only needed if you want Sheepdog typing into an open Claude or ChatGPT tab on a
schedule. In Chrome or Edge, go to `chrome://extensions`, turn on Developer
mode, choose "Load unpacked" and pick the `extension` folder. Click the
Sheepdog icon, paste the access code, and save. The dot turns green when it
connects. Add the tab from the control panel the service printed a link to.

### 3. Create the Discord bot

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application**, give it a name (e.g. "Sheepdog").
2. Open **Bot** in the sidebar → **Reset Token** → copy it somewhere safe.
   This is the only time Discord shows it to you.
3. On the same page, turn on **Message Content Intent** under Privileged
   Gateway Intents — without this the bot can see that it was mentioned but
   not what you actually typed.
4. Open **OAuth2 → URL Generator**, tick the `bot` scope, then under Bot
   Permissions tick `Send Messages` and `Read Message History`.
5. Open the URL it generates at the bottom of the page and invite the bot to
   your server. It'll sit offline until step 4 below.

### 4. Give the service the bot token

Set an environment variable before starting the service. Easiest is editing
`windows\start-sheepdog.cmd` to add a line before `node src\index.js`:

```
set SHEEPDOG_DISCORD_TOKEN=your-bot-token-here
```

Restart the service. Without this variable set, everything runs exactly as
before — the Discord piece is entirely optional and off by default. With it
set, the console prints `Discord: connected as <bot name>` once it's logged
in, and the bot goes green in Discord's member list.

Tag it in any channel it's in — `@Sheepdog fix the header bug`, with a
screenshot attached if you like — and it replies to confirm, then appends the
task as a checkbox line to today's roadmap file. Tag it again for the next
task; they pile up in the same file until the date rolls over.

### 5. Make the roadmap reachable from every device

This is the part that makes "add an idea from Discord mobile, see it land in
`roadmap.md` on the desktop" actually true, and it needs one decision: **where
does that file live?**

By default it's `<data folder>/roadmaps/` next to the service's own config —
fine for a single machine, but not synced anywhere. Point it at a folder
[Dropbox](https://www.dropbox.com/install) (or OneDrive, iCloud Drive, Syncthing
— anything that syncs a folder) is already watching instead, kept separate
from `SHEEPDOG_DATA` on purpose so your access token never has to leave this
machine just because your task list does:

```
set SHEEPDOG_ROADMAP_DIR=C:\Users\you\Dropbox\Sheepdog
```

Restart the service once more. From here:

- Tagging `@Sheepdog` from Discord mobile (or any device, anywhere — Discord
  routes the message through its own servers to wherever this service is
  running, not through your phone's network) appends to a file inside that
  Dropbox folder.
- Dropbox syncs it to every other device signed into that account — open
  `Sheepdog-Roadmap-<date>.md` directly in the synced folder on another
  desktop, or in the Dropbox app on your phone, or at dropbox.com.
- Any image attached to the mention gets **downloaded and saved next to the
  roadmap** (in an `images/` subfolder, one file per image) instead of just
  linking Discord's copy — Discord's attachment links carry a signed expiry
  and go dead after a while, so this is what makes the picture still be there
  next week. If a download ever fails (Discord hiccup, deleted message), the
  entry falls back to the original link rather than losing the reference.

No Dropbox account, or want the roadmap reachable over a real HTTPS URL from
outside your network instead of through file sync? Run a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)
pointed at the service (`cloudflared tunnel --url http://localhost:8787`) and
use the URL it gives you in place of `http://<your-pc>:8787` everywhere below
— no code changes needed either way, since the roadmap is already served over
the same HTTP API as the control panel.

### 6. Point an agent at the roadmap

The roadmap is readable over the same API the control panel uses, authenticated
the same way (query-string token, or `Authorization: Bearer <token>`):

```
GET http://<your-pc>:8787/api/roadmap?token=<your access code>          # {files, latest}
GET http://<your-pc>:8787/api/roadmap/latest?token=<your access code>   # today's file, raw markdown
GET http://<your-pc>:8787/api/roadmap/<filename>?token=<your access code>
GET http://<your-pc>:8787/api/roadmap/images/<name>?token=<your access code>
```

Tell your agent (in its system prompt, project instructions, or however it
takes standing context) to fetch the `latest` URL when asked to resume. Then
set that flock member's message to something like:

```
I am Sheepdog, bark bark. Resume the work with the following prompt - check
which tasks are already completed and continue the work until the end of the
roadmap is reached. If the end is reached, do nothing.
```

with a fixed-times schedule matching when its usage limit refreshes. No code
changes needed for this part — a flock member's message is already free text,
so this is just what you type into the control panel.

### 7. Make it permanent

```
powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1
```

This starts Sheepdog — service, and the Discord bot if you've set its token —
when you sign in, and opens its port on your private network so your phone can
reach it. Undo it with the same command plus `-Remove`.

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

The roadmap and its re-hosted images go in `<SHEEPDOG_DATA>/roadmaps/` unless
`SHEEPDOG_ROADMAP_DIR` says otherwise (see step 5 of the install guide) — kept
as a separate setting so the access token in `SHEEPDOG_DATA` never has to sit
in a synced folder just because the roadmap does.

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
- Re-hosting an attached image means downloading it from Discord's CDN as soon as
  the mention comes in — if that download fails, the roadmap keeps the original
  link rather than dropping the image, but that link will eventually expire.
- The Discord bot uses the same intents regardless of which channel it's in, so
  it reacts to `@Sheepdog` in every channel it's been added to on a server, not
  just one you designate — pick which channels to invite it to accordingly.
