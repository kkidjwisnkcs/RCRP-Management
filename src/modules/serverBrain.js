// serverBrain.js — RCRP Server Intelligence
// Scans ALL Discord channels every 2 minutes (including locked ones — bot reads all).
// Builds ONE living server-brain.json in the discord database channel.
// Edits the existing file message instead of posting new ones each cycle.
// The bot learns from what people say, stores facts, and can recall them.

'use strict';

const config = require('../config');
const db     = require('../utils/discordDb');

let _client     = null;
let _running    = false;
// channelId → last seen message snowflake (for incremental scanning)
const _lastSeen = new Map();

// Channel IDs the bot uses for its own data — never scan these (avoid loops)
const SKIP_IDS_BASE = [
  config.channels.gameDatabase,
  config.channels.discordDatabase,
  config.channels.verifyDatabase,
];

// The message ID of the living brain file (so we can edit instead of re-post)
let _brainMsgId = null;

function init(discordClient) {
  if (_running) return;
  _running = true;
  _client  = discordClient;
  console.log('[ServerBrain] Started — scanning ALL server channels every 2 min.');
  // First scan after 15 seconds (let the bot fully connect and heartbeat seed first)
  setTimeout(() => scan(), 15_000);
  setInterval(() => scan(), config.snapshotInterval);
}

async function scan() {
  try {
    const guild  = _client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild)  return;
    const dbCh   = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh)   return;

    const skipIds = new Set(SKIP_IDS_BASE);

    // Load or create the brain
    const brain = await _getBrainWithMsgId(dbCh);

    // Ensure sub-objects exist
    if (!brain.facts)         brain.facts         = [];
    if (!brain.members)       brain.members       = {};
    if (!brain.channels)      brain.channels      = {};
    if (!brain.relationships) brain.relationships = {};

    // Scan EVERY text channel the bot can see — including locked ones
    // (bot has admin/read-all, so it can read channels regular users can't)
    const channels = [...guild.channels.cache.values()].filter(c =>
      c.isTextBased() && !c.isThread() && !skipIds.has(c.id)
    );

    let totalNewMessages = 0;

    for (const ch of channels) {
      try {
        const opts = { limit: 50 };
        const lastId = _lastSeen.get(ch.id);
        if (lastId) opts.after = lastId;

        const msgs = await ch.messages.fetch(opts).catch(() => null);
        if (!msgs || !msgs.size) continue;

        // Track newest message ID for next incremental scan
        const newest = [...msgs.values()].reduce((a, b) => a.createdTimestamp > b.createdTimestamp ? a : b);
        _lastSeen.set(ch.id, newest.id);

        // Initialize channel entry
        if (!brain.channels[ch.id]) {
          brain.channels[ch.id] = { name: ch.name, messageCount: 0, lastActive: null, activeUsers: [] };
        }
        const chEntry = brain.channels[ch.id];
        chEntry.name       = ch.name;
        chEntry.lastActive = newest.createdAt.toISOString();

        const activeUsersSet = new Set(chEntry.activeUsers);

        for (const msg of msgs.values()) {
          if (msg.author.bot) continue;
          totalNewMessages++;

          const authorId  = msg.author.id;
          const authorTag = msg.author.username;
          const content   = msg.content?.slice(0, 500) || '';

          // Track member activity
          if (!brain.members[authorId]) {
            brain.members[authorId] = {
              id: authorId, username: authorTag,
              messageCount: 0, lastSeen: null,
              channels: [], knownAs: [], facts: [],
            };
          }
          const member = brain.members[authorId];
          member.username = authorTag;
          member.messageCount++;
          member.lastSeen = msg.createdAt.toISOString();
          if (!member.channels.includes(ch.name)) member.channels.push(ch.name);
          activeUsersSet.add(authorTag);
          chEntry.messageCount++;

          // Extract facts from message content (passive learning)
          extractFacts(brain, msg, content, authorId, authorTag, ch.name);
        }

        chEntry.activeUsers = [...activeUsersSet].slice(-20);
      } catch (e) {
        // No access or other error — skip silently
      }
    }

    // Prune to keep brain manageable
    if (brain.facts.length > 800) brain.facts = brain.facts.slice(-800);

    // Save — edit existing message if we know the ID, otherwise post new
    await _saveBrainEditing(dbCh, brain);
    console.log(`[ServerBrain] Scanned ${channels.length} channels, ${totalNewMessages} new messages.`);
  } catch (err) {
    console.error('[ServerBrain] scan error:', err.message);
  }
}

// ── Load brain + latch onto existing message ID ───────────
async function _getBrainWithMsgId(dbCh) {
  try {
    // If we already know the message, just fetch the attachment from it
    if (_brainMsgId) {
      const msg = await dbCh.messages.fetch(_brainMsgId).catch(() => null);
      if (msg) {
        const att = [...msg.attachments.values()].find(a => a.name === 'server-brain.json');
        if (att) {
          try {
            const resp = await fetch(att.url);
            if (resp.ok) {
              const data = await resp.json();
              return { _meta: {}, ...data };
            }
          } catch {}
        }
      }
      _brainMsgId = null; // Message gone, will search again
    }

    // Search recent messages for an existing brain file
    const msgs = await dbCh.messages.fetch({ limit: 50 });
    for (const msg of [...msgs.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)) {
      if (msg.author.id !== _client.user.id) continue;
      const att = [...msg.attachments.values()].find(a => a.name === 'server-brain.json');
      if (att) {
        try {
          const resp = await fetch(att.url);
          if (resp.ok) {
            _brainMsgId = msg.id;
            const data = await resp.json();
            return { _meta: {}, ...data };
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error('[ServerBrain] _getBrainWithMsgId error:', err.message);
  }
  // Fresh brain
  return { _meta: { version: 0 }, facts: [], members: {}, channels: {}, relationships: {} };
}

// ── Save brain — edit existing message or post new ────────
async function _saveBrainEditing(dbCh, brain) {
  brain._meta = brain._meta || {};
  brain._meta.lastScan = new Date().toISOString();
  brain._meta.version  = (brain._meta.version || 0) + 1;

  const { AttachmentBuilder } = require('discord.js');
  const buffer     = Buffer.from(JSON.stringify(brain, null, 2), 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: 'server-brain.json' });

  if (_brainMsgId) {
    const existing = await dbCh.messages.fetch(_brainMsgId).catch(() => null);
    if (existing) {
      await existing.edit({ content: '`server-brain.json` — RCRP Server Brain (live)', files: [attachment] }).catch(() => {
        _brainMsgId = null;
      });
      if (_brainMsgId) return; // edited successfully
    } else {
      _brainMsgId = null;
    }
  }

  // Post fresh
  const sent = await dbCh.send({ content: '`server-brain.json` — RCRP Server Brain (live)', files: [attachment] }).catch(() => null);
  if (sent) _brainMsgId = sent.id;
}

// ── Extract structured facts from a message ───────────────
function extractFacts(brain, msg, content, authorId, authorTag, channelName) {
  if (!content) return;
  const lower = content.toLowerCase();

  const IS_PATTERN = /(\S+(?:\s+\S+)?)\s+(?:is|are|=)\s+(.+)/i;

  // Detect bot mentions that teach relationships
  const botId = _client?.user?.id;
  const botMentionIdx = botId ? content.indexOf(`<@${botId}>`) : -1;
  if (botMentionIdx !== -1) {
    const afterMention = content.slice(botMentionIdx + `<@${botId}>`.length).trim();
    const match = afterMention.match(IS_PATTERN);
    if (match) {
      const subject = resolveSubject(match[1].trim(), msg);
      const value   = match[2].trim().slice(0, 200);
      const key     = subject.toLowerCase();
      brain.relationships[key] = {
        subject, value, setBy: authorTag, setAt: msg.createdAt.toISOString(), channel: channelName,
      };
      pushFact(brain, {
        type: 'relationship', subject, value,
        source: authorTag, channel: channelName, ts: msg.createdAt.toISOString(),
      });
      return;
    }
    pushFact(brain, {
      type: 'bot_addressed', content: content.slice(0, 300),
      source: authorTag, channel: channelName, ts: msg.createdAt.toISOString(),
    });
    return;
  }

  // Detect promotions passively
  const PROMO = /(?:got|was|is|has been)\s+(?:promoted|assigned|made|given)\s+(?:to|as)?\s*(.+)/i;
  if (PROMO.test(lower)) {
    const peopleMentioned = msg.mentions.users.map(u => u.username).join(', ');
    if (peopleMentioned) {
      pushFact(brain, {
        type: 'promotion_event', people: peopleMentioned,
        content: content.slice(0, 200), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString(),
      });
    }
  }

  // Track announcements and important channel content
  const EVENT_CHANNELS = ['announcement', 'rules', 'session', 'news', 'update', 'changelog'];
  if (EVENT_CHANNELS.some(k => channelName.includes(k)) && content.length > 20) {
    pushFact(brain, {
      type: 'announcement', content: content.slice(0, 400),
      source: authorTag, channel: channelName, ts: msg.createdAt.toISOString(),
    });
  }
}

function resolveSubject(raw, msg) {
  return raw
    .replace(/<@!?(\d+)>/g, (_, id) => {
      const u = msg.mentions.users.get(id);
      return u ? `@${u.username}` : `<@${id}>`;
    })
    .replace(/<@&(\d+)>/g, (_, id) => {
      const r = msg.guild?.roles?.cache.get(id);
      return r ? `@${r.name}` : `<@&${id}>`;
    });
}

function pushFact(brain, fact) {
  const key = JSON.stringify(fact).slice(0, 100);
  if (brain.facts.some(f => JSON.stringify(f).slice(0, 100) === key)) return;
  brain.facts.push(fact);
}

// ── Learn from a single message immediately (called from messageCreate) ──
// Only saves when the bot is directly mentioned — prevents flooding DB every message.
async function learnFromMessage(msg) {
  if (!_client || !msg.guild) return;
  // Only do an immediate DB write when the bot is mentioned — passive learning
  // happens in the 2-min scan() cycle to avoid rate limits.
  if (!msg.mentions.has(_client.user)) return;

  try {
    const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh) return;

    const brain = await _getBrainWithMsgId(dbCh);
    if (!brain.facts)         brain.facts         = [];
    if (!brain.members)       brain.members       = {};
    if (!brain.relationships) brain.relationships = {};

    const content   = msg.content?.slice(0, 500) || '';
    const authorId  = msg.author.id;
    const authorTag = msg.author.username;
    const chName    = msg.channel?.name || 'dm';

    if (!brain.members[authorId]) {
      brain.members[authorId] = { id: authorId, username: authorTag, messageCount: 0, lastSeen: null, channels: [], facts: [] };
    }
    brain.members[authorId].lastSeen = new Date().toISOString();

    extractFacts(brain, msg, content, authorId, authorTag, chName);

    if (brain.facts.length > 800) brain.facts = brain.facts.slice(-800);
    await _saveBrainEditing(dbCh, brain);
  } catch (err) {
    console.error('[ServerBrain] learnFromMessage error:', err.message);
  }
}

// ── Query brain (used by mentionHandler for smart replies) ──
async function queryBrain(query) {
  try {
    const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh) return null;
    return await _getBrainWithMsgId(dbCh);
  } catch { return null; }
}

module.exports = { init, learnFromMessage, queryBrain, scan };
