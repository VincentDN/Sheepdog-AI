const log = require('./log');
const roadmap = require('./roadmap');

// Discord's CDN puts a signed, expiring URL on every attachment (the
// ex=/is=/hm= query params), so pulling the image URL straight off the
// message and writing it to the roadmap is the simplest thing that works,
// but that link goes dead after a while. Good enough for "print it
// somewhere the agent can fetch soon after"; not a durable archive.
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?/i;

function extractTaskAndImage(message) {
  let text = message.content.replace(/<@!?\d+>/g, '').trim();

  let imageUrl = null;
  const attachment = [...message.attachments.values()].find((a) =>
    (a.contentType || '').startsWith('image/')
  );
  if (attachment) {
    imageUrl = attachment.url;
  } else {
    const match = text.match(IMAGE_URL_RE);
    if (match) {
      imageUrl = match[0];
      text = text.replace(match[0], '').trim();
    }
  }

  return { text, imageUrl };
}

/**
 * Starts the Discord side of Sheepdog: listens for @mentions in any
 * channel the bot has been added to and appends them as roadmap tasks.
 * Returns the client, or null if there's no token to log in with (the
 * rest of the service works fine without it — this piece is optional).
 */
function start(token) {
  if (!token) {
    console.log('  Discord: no SHEEPDOG_DISCORD_TOKEN set, skipping.');
    return null;
  }

  let Client, GatewayIntentBits, Events;
  try {
    ({ Client, GatewayIntentBits, Events } = require('discord.js'));
  } catch (_) {
    console.error('  Discord: "discord.js" is not installed. Run npm install in service/.');
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.once(Events.ClientReady, () => {
    console.log('  Discord: connected as ' + client.user.tag);
    log.add({ status: 'info', detail: 'Discord bot connected as ' + client.user.tag });
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!client.user || !message.mentions.has(client.user)) return;

    const { text, imageUrl } = extractTaskAndImage(message);
    if (!text) {
      await message.reply('🐑 Tell me what to add to the roadmap.').catch(() => {});
      return;
    }

    const entry = await roadmap.addEntry({
      text,
      imageUrl,
      author: message.member?.displayName || message.author.username
    });

    log.add({ status: 'info', detail: 'Discord: added "' + text + '" to ' + entry.file });
    await message.reply('🐑 Logged to `' + entry.file + '`.').catch(() => {});
  });

  client.on(Events.Error, (err) => {
    console.error('  Discord error: ' + err.message);
  });

  client.login(token).catch((err) => {
    console.error('  Discord: could not log in — ' + err.message);
    log.add({ status: 'failed', detail: 'Discord login failed: ' + err.message });
  });

  return client;
}

module.exports = { start, extractTaskAndImage };
