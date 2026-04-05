// ============================================================
// RCRP Management — Main Entry Point
// River City Role Play Management Bot
// Architecture: Zero-Persistence (Discord-as-Database)
// ============================================================

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ── Validate required environment variables ───────────────
const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missing  = required.filter(v => !process.env[v]);
if (missing.length) {
  console.error(`[RCRP Management] ❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('[RCRP Management] Please set these in Railway before starting the bot.');
  process.exit(1);
}

// ── Create Discord client ─────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

// ── Load commands ─────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`[RCRP Management] Loaded command: /${command.data.name}`);
  }
}

// ── Load events ───────────────────────────────────────────
const eventsPath = path.join(__dirname, 'src', 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  const handler = (...args) => event.execute(...args, client);

  if (event.once) {
    client.once(event.name, handler);
  } else {
    client.on(event.name, handler);
  }
  console.log(`[RCRP Management] Registered event: ${event.name}`);
}

// ── Global error handlers ─────────────────────────────────
process.on('unhandledRejection', err => {
  console.error('[RCRP Management] Unhandled Promise Rejection:', err);
});

process.on('uncaughtException', err => {
  console.error('[RCRP Management] Uncaught Exception:', err);
});

// ── Connect to Discord ────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).then(() => {
  console.log('[RCRP Management] Connecting to Discord...');
}).catch(err => {
  console.error('[RCRP Management] ❌ Failed to login:', err.message);
  process.exit(1);
});
