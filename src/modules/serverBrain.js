// serverBrain.js — THE ONE TRUE SCANNER
// • Scans all channels every 2 min — brain stats + channel content index in one pass
// • Saves ONE living server-brain.json to the Discord database channel (edits in place)
// • Exports channel index so dbScanner is just a thin proxy (no duplicate work)
// • In-memory cache so replies never wait on Discord API

'use strict';

const config = require('../config');
const db     = require('../utils/discordDb');

let _client      = null;
let _running     = false;
let _scanning    = false;          // prevent overlapping scans
let _cachedBrain = null;           // in-memory brain, updated after every scan
let _brainMsgId  = null;           // message ID of the brain file in db channel

// ── Channel content index (replaces dbScanner) ───────────────────────────────
// channelId → { id, name, content, lastScanned }
const _channelIndex = new Map();

// channelId → last seen message snowflake (incremental scanning)
const _lastSeen = new Map();

// Channels we own — never scan these (avoid feedback loops)
const SKIP_IDS = new Set([
  config.channels.gameDatabase,
  config.channels.discordDatabase,
  config.channels.verifyDatabase,
]);

// ── init ─────────────────────────────────────────────────────────────────────
function init(discordClient) {
  if (_running) return;
  _running = true;
  _client  = discordClient;
  console.log('[Brain] Started — scanning all channels every 2 min.');
  setTimeout(() => scan(), 12_000);                   // first scan after 12s
  setInterval(() => scan(), config.snapshotInterval); // then every 2 min
}

// ── Main scan ────────────────────────────────────────────────────────────────
async function scan() {
  if (_scanning) return;
  _scanning = true;

  try {
    const guild = _client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;
    const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh) { console.warn('[Brain] discordDatabase channel not found — check config.channels.discordDatabase'); return; }

    // Load brain from cache or Discord
    const brain = _cachedBrain || await _loadBrain(dbCh);
    brain.facts         = brain.facts         || [];
    brain.members       = brain.members       || {};
    brain.channels      = brain.channels      || {};
    brain.relationships = brain.relationships || {};
    brain.guildMembers  = brain.guildMembers  || {};

    // ── Enrich guildMembers from Discord member cache ─────────────────────
    // Only re-fetch if we have fewer than half the expected members (avoids rate limits)
    const cachedMemberCount = guild.members.cache.size;
    const approxTotal       = guild.memberCount || 0;
    if (cachedMemberCount < approxTotal * 0.5) {
      await guild.members.fetch().catch(e => console.warn('[Brain] members.fetch:', e.message));
    }

    for (const [, gm] of guild.members.cache) {
      if (gm.user.bot) continue;
      const topRole = [...gm.roles.cache.values()]
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)[0];

      brain.guildMembers[gm.id] = {
        id:          gm.id,
        username:    gm.user.username,
        displayName: gm.displayName,
        topRole:     topRole?.name || 'Member',
        roles:       [...gm.roles.cache.values()]
                       .filter(r => r.id !== guild.id)
                       .sort((a, b) => b.position - a.position)
                       .map(r => r.name)
                       .slice(0, 8),
        joinedAt:    gm.joinedAt?.toISOString() || null,
      };

      if (brain.members[gm.id]) {
        brain.members[gm.id].displayName = gm.displayName;
        brain.members[gm.id].topRole     = topRole?.name || 'Member';
        brain.members[gm.id].roles       = brain.guildMembers[gm.id].roles;
      }
    }

    // ── Scan text channels ────────────────────────────────────────────────
    const channels = [...guild.channels.cache.values()].filter(
      c => c.isTextBased() && !c.isThread() && !SKIP_IDS.has(c.id)
    );

    let totalNew = 0;

    for (const ch of channels) {
      try {
        const isFirstScan = !_lastSeen.has(ch.id);
        const opts = { limit: isFirstScan ? 100 : 50 };
        if (!isFirstScan) opts.after = _lastSeen.get(ch.id);

        const msgs = await ch.messages.fetch(opts).catch(() => null);
        if (!msgs || !msgs.size) continue;

        const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const newest = sorted[sorted.length - 1];
        _lastSeen.set(ch.id, newest.id);

        // ── Brain stats ──────────────────────────────────────────────────
        if (!brain.channels[ch.id]) {
          brain.channels[ch.id] = { name: ch.name, messageCount: 0, lastActive: null, activeUsers: [] };
        }
        const chEntry = brain.channels[ch.id];
        chEntry.name       = ch.name;
        chEntry.lastActive = newest.createdAt.toISOString();
        const activeSet    = new Set(chEntry.activeUsers);

        for (const msg of sorted) {
          if (msg.author.bot) continue;
          totalNew++;
          const authorId = msg.author.id;
          const username = msg.author.username;
          const text     = msg.content?.slice(0, 500) || '';

          if (!brain.members[authorId]) {
            brain.members[authorId] = { id: authorId, username, messageCount: 0, lastSeen: null, channels: [], knownAs: [], facts: [] };
          }
          const m       = brain.members[authorId];
          m.username    = username;
          m.messageCount++;
          m.lastSeen    = msg.createdAt.toISOString();
          if (!m.channels.includes(ch.name)) m.channels.push(ch.name);
          activeSet.add(username);
          chEntry.messageCount++;

          extractFacts(brain, msg, text, authorId, username, ch.name);
        }

        chEntry.activeUsers = [...activeSet].slice(-20);

        // ── Channel content index ────────────────────────────────────────
        // Build text for every message (including embeds)
        const newLines = sorted.map(m => {
          const parts = [];
          if (m.content?.trim()) parts.push(m.content.trim());
          for (const e of m.embeds || []) {
            const ep = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean);
            if (ep.length) parts.push(ep.join(' | '));
          }
          return parts.join(' ').trim();
        }).filter(Boolean);

        if (newLines.length) {
          const existing    = _channelIndex.get(ch.id)?.content || '';
          const combined    = (existing ? existing + '\n' + newLines.join('\n') : newLines.join('\n'));
          // Keep last ~15000 chars — enough context, not too much to slow queries
          const trimmed     = combined.length > 15000 ? combined.slice(-15000) : combined;
          _channelIndex.set(ch.id, { id: ch.id, name: ch.name, content: trimmed, lastScanned: new Date().toISOString() });
        }
      } catch { /* no access — skip */ }
    }

    // Prune
    if (brain.facts.length > 800) brain.facts = brain.facts.slice(-800);

    _cachedBrain = brain;

    // Save brain file to Discord
    await _saveBrain(dbCh, brain);

    console.log(`[Brain] ✅ ${channels.length} channels | ${totalNew} new msgs | ${Object.keys(brain.guildMembers).length} members | ${_channelIndex.size} indexed`);
  } catch (err) {
    console.error('[Brain] scan error:', err.message);
  } finally {
    _scanning = false;
  }
}

// ── Load brain from Discord database channel ──────────────────────────────────
async function _loadBrain(dbCh) {
  try {
    if (_brainMsgId) {
      const msg = await dbCh.messages.fetch(_brainMsgId).catch(() => null);
      if (msg) {
        const att = [...msg.attachments.values()].find(a => a.name === 'server-brain.json');
        if (att) {
          const resp = await fetch(att.url).catch(() => null);
          if (resp?.ok) { const d = await resp.json(); return { _meta: {}, ...d }; }
        }
      }
      _brainMsgId = null;
    }

    // Search the last 50 messages for an existing brain file
    const msgs = await dbCh.messages.fetch({ limit: 50 });
    for (const msg of [...msgs.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)) {
      if (msg.author.id !== _client.user.id) continue;
      const att = [...msg.attachments.values()].find(a => a.name === 'server-brain.json');
      if (att) {
        const resp = await fetch(att.url).catch(() => null);
        if (resp?.ok) { _brainMsgId = msg.id; const d = await resp.json(); return { _meta: {}, ...d }; }
      }
    }
  } catch (err) {
    console.error('[Brain] _loadBrain error:', err.message);
  }
  return { _meta: { version: 0 }, facts: [], members: {}, channels: {}, relationships: {}, guildMembers: {} };
}

// ── Save brain to Discord — edit in place or post new ────────────────────────
async function _saveBrain(dbCh, brain) {
  brain._meta          = brain._meta || {};
  brain._meta.lastScan = new Date().toISOString();
  brain._meta.version  = (brain._meta.version || 0) + 1;

  // Size safety — Discord attachment limit is 8MB
  let payload = brain;
  const raw   = JSON.stringify(brain, null, 2);
  if (Buffer.byteLength(raw) > 7_500_000) {
    payload = {
      ...brain,
      facts:   brain.facts.slice(-300),
      members: Object.fromEntries(Object.entries(brain.members).slice(-400)),
    };
    console.warn('[Brain] Brain trimmed for size limit.');
  }

  const { AttachmentBuilder } = require('discord.js');
  const buf  = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
  const att  = new AttachmentBuilder(buf, { name: 'server-brain.json' });
  const label = `\`server-brain.json\` — FSRP Server Brain | v${brain._meta.version} | ${new Date().toLocaleTimeString()}`;

  if (_brainMsgId) {
    try {
      const existing = await dbCh.messages.fetch(_brainMsgId);
      await existing.edit({ content: label, files: [att], attachments: [] });
      return;
    } catch (err) {
      console.warn('[Brain] Edit failed, will post fresh:', err.message);
      _brainMsgId = null;
    }
  }

  try {
    const sent = await dbCh.send({ content: label, files: [att] });
    _brainMsgId = sent.id;
    console.log('[Brain] Brain file posted to database channel.');
  } catch (err) {
    console.error('[Brain] Could not save brain file:', err.message);
  }
}

// ── getContextForQuery — clean format, no inline [Source:] markers ────────────
function getContextForQuery(query) {
  if (_channelIndex.size === 0) {
    return 'Server knowledge is loading — the bot just started. Try again in 15 seconds.';
  }

  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Score each channel by keyword relevance
  const scored = [..._channelIndex.values()].map(ch => {
    const hay   = (ch.name + ' ' + ch.content).toLowerCase();
    const score = qWords.reduce((a, w) => a + (hay.split(w).length - 1), 0);
    return { ...ch, score };
  }).filter(c => c.score > 0 || /rule|info|announce|guide|faq|handbook|welcome/i.test(c.name))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const list = scored.length
    ? scored
    : [..._channelIndex.values()].filter(c => /rule|info|announce|guide|faq|welcome/i.test(c.name)).slice(0, 4);

  if (!list.length) return [..._channelIndex.values()].slice(0, 3).map(c => `=== #${c.name} ===\n${c.content.slice(0, 800)}`).join('\n\n---\n\n');

  return list.map(c => `=== #${c.name} ===\n${c.content.slice(0, 1200)}`).join('\n\n---\n\n');
}

// ── getAllContext — dump everything (for broad queries) ────────────────────────
function getAllContext() {
  return [..._channelIndex.values()]
    .map(c => `=== #${c.name} ===\n${c.content.slice(0, 2000)}`)
    .join('\n\n')
    .slice(0, 12000);
}

// ── indexChannelContent — called by mentionHandler after a live channel fetch ─
function indexChannelContent(channelId, channelName, sortedMsgs) {
  const lines = sortedMsgs.map(m => {
    const parts = [];
    if (m.content?.trim()) parts.push(m.content.trim());
    for (const e of m.embeds || []) {
      const ep = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean);
      if (ep.length) parts.push(ep.join(' | '));
    }
    return parts.join(' ').trim();
  }).filter(Boolean);

  if (!lines.length) return;
  const existing = _channelIndex.get(channelId)?.content || '';
  const combined = (existing ? existing + '\n' + lines.join('\n') : lines.join('\n'));
  _channelIndex.set(channelId, { id: channelId, name: channelName, content: combined.slice(-15000), lastScanned: new Date().toISOString() });
}

// ── extractFacts ──────────────────────────────────────────────────────────────
function extractFacts(brain, msg, content, authorId, authorTag, channelName) {
  if (!content) return;
  const lower      = content.toLowerCase();
  const IS_PATTERN = /(\S+(?:\s+\S+)?)\s+(?:is|are|=)\s+(.+)/i;

  const botId         = _client?.user?.id;
  const botMentionIdx = botId ? content.indexOf(`<@${botId}>`) : -1;

  if (botMentionIdx !== -1) {
    const after = content.slice(botMentionIdx + `<@${botId}>`.length).trim();
    const match = after.match(IS_PATTERN);
    if (match) {
      const subject = resolveSubject(match[1].trim(), msg);
      const value   = match[2].trim().slice(0, 200);
      brain.relationships[subject.toLowerCase()] = { subject, value, setBy: authorTag, setAt: msg.createdAt.toISOString(), channel: channelName };
      pushFact(brain, { type: 'relationship', subject, value, source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
    } else {
      pushFact(brain, { type: 'bot_addressed', content: content.slice(0, 300), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
    }
    return;
  }

  const PROMO = /(?:got|was|is|has been)\s+(?:promoted|assigned|made|given)\s+(?:to|as)?\s*(.+)/i;
  if (PROMO.test(lower)) {
    const people = msg.mentions.users.map(u => u.username).join(', ');
    if (people) pushFact(brain, { type: 'promotion_event', people, content: content.slice(0, 200), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
  }

  if (/announcement|rules|session|news|update|changelog/i.test(channelName) && content.length > 20) {
    pushFact(brain, { type: 'announcement', content: content.slice(0, 400), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
  }
}

function resolveSubject(raw, msg) {
  return raw
    .replace(/<@!?(\d+)>/g, (_, id) => { const u = msg.mentions.users.get(id); return u ? `@${u.username}` : `<@${id}>`; })
    .replace(/<@&(\d+)>/g, (_, id) => { const r = msg.guild?.roles?.cache.get(id); return r ? `@${r.name}` : `<@&${id}>`; });
}

function pushFact(brain, fact) {
  const key = JSON.stringify(fact).slice(0, 100);
  if (!brain.facts.some(f => JSON.stringify(f).slice(0, 100) === key)) brain.facts.push(fact);
}

// ── learnFromMessage — immediate update on bot mention ───────────────────────
async function learnFromMessage(msg) {
  if (!_client || !msg.guild || !msg.mentions.has(_client.user)) return;
  try {
    const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh) return;

    const brain = _cachedBrain || await _loadBrain(dbCh);
    brain.facts         = brain.facts         || [];
    brain.members       = brain.members       || {};
    brain.relationships = brain.relationships || {};

    const content  = msg.content?.slice(0, 500) || '';
    const authorId = msg.author.id;
    const username = msg.author.username;

    if (!brain.members[authorId]) {
      brain.members[authorId] = { id: authorId, username, messageCount: 0, lastSeen: null, channels: [], facts: [] };
    }
    brain.members[authorId].lastSeen    = new Date().toISOString();
    brain.members[authorId].displayName = msg.member?.displayName || username;

    extractFacts(brain, msg, content, authorId, username, msg.channel?.name || 'dm');

    if (brain.facts.length > 800) brain.facts = brain.facts.slice(-800);
    _cachedBrain = brain;
    await _saveBrain(dbCh, brain);
  } catch (err) {
    console.error('[Brain] learnFromMessage error:', err.message);
  }
}

// ── Public exports ────────────────────────────────────────────────────────────
function getCachedBrain()   { return _cachedBrain; }
function getChannelIndexMap() { return _channelIndex; }

function getMemberByUsername(name) {
  if (!_cachedBrain) return null;
  const lower = name.toLowerCase();
  for (const gm of Object.values(_cachedBrain.guildMembers || {})) {
    if (gm.username?.toLowerCase() === lower || gm.displayName?.toLowerCase() === lower || gm.username?.toLowerCase().includes(lower)) {
      return { ...gm, activity: _cachedBrain.members?.[gm.id] || null };
    }
  }
  for (const m of Object.values(_cachedBrain.members || {})) {
    if (m.username?.toLowerCase() === lower || m.displayName?.toLowerCase() === lower || m.username?.toLowerCase().includes(lower)) return m;
  }
  return null;
}

async function queryBrain() {
  if (_cachedBrain) return _cachedBrain;
  try {
    const dbCh = _client?.channels?.cache.get(config.channels.discordDatabase);
    return dbCh ? await _loadBrain(dbCh) : null;
  } catch { return null; }
}

module.exports = {
  init, scan, learnFromMessage,
  getCachedBrain, getMemberByUsername, queryBrain,
  getContextForQuery, getAllContext, getChannelIndexMap, indexChannelContent,
};
