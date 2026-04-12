// serverBrain.js — GOAT Edition
// • Regular scan: every 2 min, picks up new messages incrementally
// • Deep historical scan: on startup, paginates EVERY channel back 2 years
//   - Runs in background (non-blocking), resumes on restart, progress saved to brain file
// • ONE brain file on Discord — edits in place, never spams
// • Full channel content index in memory (no Discord size limits)
// • Exports everything dbScanner used to — no duplicate scanning

'use strict';

const config = require('../config');
const db     = require('../utils/discordDb');

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

let _client      = null;
let _running     = false;
let _scanning    = false;    // lock — prevent overlapping regular scans
let _cachedBrain = null;
let _brainMsgId  = null;

// ── In-memory channel index ───────────────────────────────────────────────────
// channelId → { id, name, content, messageCount, lastScanned }
// content stores timestamped lines: "[Jan 15, 2024] username: message text"
// No hard size limit per channel — we store everything, cap at 500k chars
const _channelIndex = new Map();

// channelId → newest message snowflake seen (for incremental scanning)
const _lastSeen = new Map();

// Channels the bot owns — never scan (avoid feedback loops)
const SKIP_IDS = new Set([
  config.channels.gameDatabase,
  config.channels.discordDatabase,
  config.channels.verifyDatabase,
]);

// ─────────────────────────────────────────────────────────────────────────────
// init
// ─────────────────────────────────────────────────────────────────────────────
function init(discordClient) {
  if (_running) return;
  _running = true;
  _client  = discordClient;
  console.log('[Brain] Initializing — first scan in 12s, then every 2 min.');

  setTimeout(async () => {
    await scan();
    // Launch deep history in background — never blocks regular scans
    _deepHistoricalScan().catch(e => console.error('[Brain] deepScan crashed:', e.message));
  }, 12_000);

  setInterval(() => scan(), config.snapshotInterval);
}

// ─────────────────────────────────────────────────────────────────────────────
// Regular incremental scan (every 2 min)
// ─────────────────────────────────────────────────────────────────────────────
async function scan() {
  if (_scanning) return;
  _scanning = true;

  try {
    const guild = _client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;
    const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh) {
      console.warn('[Brain] discordDatabase channel not found! Check config.channels.discordDatabase');
      return;
    }

    const brain = _cachedBrain || await _loadBrain(dbCh);
    _ensureBrainShape(brain);

    // Refresh Discord member profiles
    const cacheRatio = guild.members.cache.size / Math.max(guild.memberCount || 1, 1);
    if (cacheRatio < 0.5) {
      await guild.members.fetch().catch(e => console.warn('[Brain] members.fetch:', e.message));
    }
    _enrichGuildMembers(brain, guild);

    // Scan every accessible text channel
    const channels = _getTextChannels(guild);
    let totalNew = 0;

    for (const ch of channels) {
      try {
        const isFirst = !_lastSeen.has(ch.id);
        const opts    = { limit: isFirst ? 100 : 50 };
        if (!isFirst) opts.after = _lastSeen.get(ch.id);

        const msgs = await ch.messages.fetch(opts).catch(() => null);
        if (!msgs?.size) continue;

        const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        _lastSeen.set(ch.id, sorted[sorted.length - 1].id);

        totalNew += _processMsgs(brain, ch, sorted, true); // true = update channel index
      } catch { /* no access */ }
    }

    if (brain.facts.length > 3000) brain.facts = brain.facts.slice(-3000);

    _cachedBrain = brain;
    await _saveBrain(dbCh, brain);
    console.log(`[Brain] ✅ Regular scan: ${totalNew} new msgs across ${channels.length} channels | ${_channelIndex.size} indexed in memory`);
  } catch (err) {
    console.error('[Brain] scan error:', err.message);
  } finally {
    _scanning = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep historical scan — paginates EVERYTHING back 2 years
// Runs in background after first scan. Saves progress to brain so it resumes
// on restart and never re-scans an already-complete channel.
// ─────────────────────────────────────────────────────────────────────────────
async function _deepHistoricalScan() {
  const guild = _client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;
  const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
  if (!dbCh) return;

  const brain = _cachedBrain || await _loadBrain(dbCh);
  _ensureBrainShape(brain);

  const allChannels = _getTextChannels(guild);

  // Which channels still need history scanned?
  const pending = allChannels.filter(c => !brain.historyScan?.channels?.[c.id]?.done);

  if (!pending.length) {
    console.log('[Brain] Deep history already complete for all channels. Nothing to do.');
    return;
  }

  const totalCh = allChannels.length;
  const done    = totalCh - pending.length;
  console.log(`[Brain] 📚 Deep historical scan starting — ${pending.length} channels to scan (${done}/${totalCh} already done)`);

  brain.historyScan             = brain.historyScan || {};
  brain.historyScan.channels    = brain.historyScan.channels || {};
  brain.historyScan.startedAt   = brain.historyScan.startedAt || new Date().toISOString();

  const cutoff    = Date.now() - TWO_YEARS_MS;
  let   processed = 0;

  for (const ch of pending) {
    const t0         = Date.now();
    let   before     = _lastSeen.get(ch.id); // start just before what regular scan already got
    let   msgCount   = 0;
    const allLines   = [];
    let   hitCutoff  = false;

    console.log(`[Brain] 📖 Scanning history: #${ch.name}…`);

    // Paginate backwards until we hit 2 years ago
    while (!hitCutoff) {
      try {
        const opts = { limit: 100 };
        if (before) opts.before = before;

        const batch = await ch.messages.fetch(opts).catch(() => null);
        if (!batch?.size) break;

        const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const oldest = sorted[0];

        // Filter to within the 2-year window
        const within = sorted.filter(m => m.createdTimestamp >= cutoff);

        // Process brain stats for everything within range
        msgCount += _processMsgs(brain, ch, within, false); // false = don't touch channel index yet

        // Add timestamped lines for the index
        for (const m of within) {
          const parts = [];
          const ts    = _fmtDate(m.createdTimestamp);
          const name  = m.member?.displayName || m.author.username;
          if (m.content?.trim()) parts.push(`[${ts}] ${name}: ${m.content.trim()}`);
          for (const e of m.embeds || []) {
            const ep = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean).join(' | ');
            if (ep) parts.push(`[${ts}] [embed] ${ep}`);
          }
          if (parts.length) allLines.push(parts.join(' '));
        }

        if (oldest.createdTimestamp < cutoff) { hitCutoff = true; break; }

        before = oldest.id;
        await _sleep(150); // rate-limit: 150ms between pages (~6-7 req/s)
      } catch (e) {
        console.warn(`[Brain] Error paginating #${ch.name}:`, e.message);
        break;
      }
    }

    // Merge historical lines (oldest first) with whatever the regular scan already stored
    if (allLines.length) {
      const histText  = allLines.join('\n');               // oldest → newest
      const recentTxt = _channelIndex.get(ch.id)?.content || '';
      const combined  = histText + (recentTxt ? '\n' + recentTxt : '');
      // Store up to 500k chars — roughly 10,000-15,000 messages
      _channelIndex.set(ch.id, {
        id:           ch.id,
        name:         ch.name,
        content:      combined.length > 500_000 ? combined.slice(-500_000) : combined,
        messageCount: msgCount,
        lastScanned:  new Date().toISOString(),
      });
    }

    // Mark done in brain (persisted to Discord so restarts resume correctly)
    brain.historyScan.channels[ch.id] = {
      done:        true,
      messages:    msgCount,
      completedAt: new Date().toISOString(),
      elapsed:     `${Math.round((Date.now() - t0) / 1000)}s`,
    };

    processed++;
    console.log(`[Brain] ✅ #${ch.name}: ${msgCount} historical msgs (${processed}/${pending.length})`);

    // Save brain every 5 channels to preserve progress against crashes/deploys
    if (processed % 5 === 0) {
      _cachedBrain = brain;
      await _saveBrain(dbCh, brain).catch(() => {});
    }

    await _sleep(500); // be respectful between channels
  }

  brain.historyScan.completedAt = new Date().toISOString();
  brain.historyScan.totalMessages = Object.values(brain.historyScan.channels)
    .reduce((a, c) => a + (c.messages || 0), 0);

  _cachedBrain = brain;
  await _saveBrain(dbCh, brain);

  const totalMsgs = [..._channelIndex.values()].reduce((a, c) => a + (c.messageCount || 0), 0);
  console.log(`[Brain] 🎉 DEEP SCAN COMPLETE — ${allChannels.length} channels, ${totalMsgs.toLocaleString()} messages in index`);
}

// ─────────────────────────────────────────────────────────────────────────────
// _processMsgs — update brain stats from a batch of messages
// Returns the count of non-bot messages processed
// ─────────────────────────────────────────────────────────────────────────────
function _processMsgs(brain, ch, sorted, updateIndex) {
  if (!brain.channels[ch.id]) {
    brain.channels[ch.id] = { name: ch.name, messageCount: 0, lastActive: null, activeUsers: [] };
  }
  const chEntry  = brain.channels[ch.id];
  chEntry.name   = ch.name;
  const activeSet = new Set(chEntry.activeUsers);
  let count = 0;

  for (const msg of sorted) {
    if (msg.author.bot) continue;
    count++;
    const authorId = msg.author.id;
    const username = msg.author.username;
    const text     = msg.content?.slice(0, 500) || '';

    if (!brain.members[authorId]) {
      brain.members[authorId] = {
        id: authorId, username, messageCount: 0,
        firstSeen: null, lastSeen: null, channels: [], facts: [],
      };
    }
    const m       = brain.members[authorId];
    m.username    = username;
    m.messageCount++;
    const ts = msg.createdAt.toISOString();
    if (!m.firstSeen || ts < m.firstSeen) m.firstSeen = ts;
    if (!m.lastSeen  || ts > m.lastSeen)  m.lastSeen  = ts;
    if (!m.channels.includes(ch.name)) m.channels.push(ch.name);

    activeSet.add(username);
    chEntry.messageCount++;
    if (!chEntry.lastActive || ts > chEntry.lastActive) chEntry.lastActive = ts;

    extractFacts(brain, msg, text, authorId, username, ch.name);
  }

  chEntry.activeUsers = [...activeSet].slice(-20);

  // Optionally update channel content index (used by regular scan for recent msgs)
  if (updateIndex && sorted.length) {
    const lines = sorted.map(m => {
      const parts = [];
      const ts    = _fmtDate(m.createdTimestamp);
      const name  = m.member?.displayName || m.author.username;
      if (m.content?.trim()) parts.push(`[${ts}] ${name}: ${m.content.trim()}`);
      for (const e of m.embeds || []) {
        const ep = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean).join(' | ');
        if (ep) parts.push(`[embed] ${ep}`);
      }
      return parts.join(' ').trim();
    }).filter(Boolean);

    if (lines.length) {
      const existing = _channelIndex.get(ch.id)?.content || '';
      const combined = existing ? existing + '\n' + lines.join('\n') : lines.join('\n');
      _channelIndex.set(ch.id, {
        id: ch.id, name: ch.name,
        content: combined.length > 500_000 ? combined.slice(-500_000) : combined,
        lastScanned: new Date().toISOString(),
      });
    }
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load brain from Discord database channel
// ─────────────────────────────────────────────────────────────────────────────
async function _loadBrain(dbCh) {
  try {
    if (_brainMsgId) {
      const msg = await dbCh.messages.fetch(_brainMsgId).catch(() => null);
      if (msg) {
        const att = [...msg.attachments.values()].find(a => a.name === 'server-brain.json');
        if (att) {
          const r = await fetch(att.url).catch(() => null);
          if (r?.ok) { const d = await r.json(); return { _meta: {}, ...d }; }
        }
      }
      _brainMsgId = null;
    }

    const msgs = await dbCh.messages.fetch({ limit: 50 });
    for (const msg of [...msgs.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)) {
      if (msg.author.id !== _client.user.id) continue;
      const att = [...msg.attachments.values()].find(a => a.name === 'server-brain.json');
      if (att) {
        const r = await fetch(att.url).catch(() => null);
        if (r?.ok) { _brainMsgId = msg.id; const d = await r.json(); return { _meta: {}, ...d }; }
      }
    }
  } catch (err) {
    console.error('[Brain] _loadBrain error:', err.message);
  }
  return { _meta: { version: 0 }, facts: [], members: {}, channels: {}, relationships: {}, guildMembers: {}, historyScan: { channels: {} } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Save brain — edit existing message (with attachments:[]) or post new
// ─────────────────────────────────────────────────────────────────────────────
async function _saveBrain(dbCh, brain) {
  brain._meta          = brain._meta || {};
  brain._meta.lastScan = new Date().toISOString();
  brain._meta.version  = (brain._meta.version || 0) + 1;

  // Trim if over 7.5 MB
  let payload = brain;
  if (Buffer.byteLength(JSON.stringify(brain)) > 7_500_000) {
    payload = { ...brain, facts: brain.facts.slice(-1000), members: Object.fromEntries(Object.entries(brain.members).slice(-600)) };
    console.warn('[Brain] Trimmed for Discord size limit.');
  }

  const { AttachmentBuilder } = require('discord.js');
  const buf   = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
  const att   = new AttachmentBuilder(buf, { name: 'server-brain.json' });
  const histDone  = Object.values(brain.historyScan?.channels || {}).filter(c => c.done).length;
  const histTotal = _getTextChannels(_client.guilds.cache.get(process.env.GUILD_ID))?.length || '?';
  const label = `\`server-brain.json\` v${brain._meta.version} | history: ${histDone}/${histTotal} channels | ${new Date().toLocaleTimeString()}`;

  if (_brainMsgId) {
    try {
      const existing = await dbCh.messages.fetch(_brainMsgId);
      await existing.edit({ content: label, files: [att], attachments: [] });
      return;
    } catch (err) {
      console.warn('[Brain] Edit failed, posting fresh:', err.message);
      _brainMsgId = null;
    }
  }

  try {
    const sent = await dbCh.send({ content: label, files: [att] });
    _brainMsgId = sent.id;
    console.log('[Brain] Brain file posted to database channel ✅');
  } catch (err) {
    console.error('[Brain] CRITICAL: Could not save brain file:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// extractFacts — passive fact learning from messages
// ─────────────────────────────────────────────────────────────────────────────
function extractFacts(brain, msg, content, authorId, authorTag, channelName) {
  if (!content) return;
  const lower = content.toLowerCase();

  const botId = _client?.user?.id;
  const botIdx = botId ? content.indexOf(`<@${botId}>`) : -1;

  if (botIdx !== -1) {
    const after = content.slice(botIdx + `<@${botId}>`.length).trim();
    const match = after.match(/(\S+(?:\s+\S+)?)\s+(?:is|are|=)\s+(.+)/i);
    if (match) {
      const subject = _resolveSubject(match[1].trim(), msg);
      const value   = match[2].trim().slice(0, 200);
      brain.relationships[subject.toLowerCase()] = { subject, value, setBy: authorTag, setAt: msg.createdAt.toISOString(), channel: channelName };
      _pushFact(brain, { type: 'relationship', subject, value, source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
    } else {
      _pushFact(brain, { type: 'bot_addressed', content: content.slice(0, 300), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
    }
    return;
  }

  if (/(?:got|was|is|has been)\s+(?:promoted|assigned|made|given)\s+(?:to|as)?\s*(.+)/i.test(lower)) {
    const people = msg.mentions.users.map(u => u.username).join(', ');
    if (people) _pushFact(brain, { type: 'promotion_event', people, content: content.slice(0, 200), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
  }

  if (/announcement|rules|session|news|update|changelog/i.test(channelName) && content.length > 20) {
    _pushFact(brain, { type: 'announcement', content: content.slice(0, 400), source: authorTag, channel: channelName, ts: msg.createdAt.toISOString() });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// learnFromMessage — called on every bot @mention for immediate learning
// ─────────────────────────────────────────────────────────────────────────────
async function learnFromMessage(msg) {
  if (!_client || !msg.guild || !msg.mentions.has(_client.user)) return;
  try {
    const dbCh = _client.channels.cache.get(config.channels.discordDatabase);
    if (!dbCh) return;

    const brain = _cachedBrain || await _loadBrain(dbCh);
    _ensureBrainShape(brain);

    const authorId = msg.author.id;
    const username = msg.author.username;
    if (!brain.members[authorId]) {
      brain.members[authorId] = { id: authorId, username, messageCount: 0, firstSeen: null, lastSeen: null, channels: [], facts: [] };
    }
    brain.members[authorId].lastSeen    = new Date().toISOString();
    brain.members[authorId].displayName = msg.member?.displayName || username;

    extractFacts(brain, msg, msg.content?.slice(0, 500) || '', authorId, username, msg.channel?.name || 'dm');
    if (brain.facts.length > 3000) brain.facts = brain.facts.slice(-3000);
    _cachedBrain = brain;
    await _saveBrain(dbCh, brain);
  } catch (err) {
    console.error('[Brain] learnFromMessage error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getContextForQuery — keyword-aware extraction from full channel history
// Rules/pinned content lives at the START (oldest). Recent chat at the END.
// We search the ENTIRE content for each keyword and extract windows around
// every hit, so a rule posted 2 years ago is still found and returned.
// ─────────────────────────────────────────────────────────────────────────────
function getContextForQuery(query) {
  if (_channelIndex.size === 0) {
    return 'Server knowledge is loading — bot just started. Try again in 30 seconds.';
  }

  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Score every channel by keyword hits across the FULL content
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

  if (!list.length) {
    return [..._channelIndex.values()].slice(0, 3).map(c => `=== #${c.name} ===\n${_extractRelevant(c.content, qWords, 1200)}`).join('\n\n---\n\n');
  }

  return list.map(c => `=== #${c.name} ===\n${_extractRelevant(c.content, qWords, 2000)}`).join('\n\n---\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// _extractRelevant — finds keyword matches ANYWHERE in content and returns
// windows around them, plus always includes the recent tail.
// This means rules/pins from years ago are found even in a 500k-char index.
// ─────────────────────────────────────────────────────────────────────────────
function _extractRelevant(content, qWords, maxLen) {
  const lower    = content.toLowerCase();
  const windows  = new Set();

  for (const word of qWords) {
    let idx = 0;
    while (true) {
      const pos = lower.indexOf(word, idx);
      if (pos === -1) break;
      // Snap to nearest line boundary for cleaner extraction
      const lineStart = content.lastIndexOf('\n', Math.max(0, pos - 300));
      const lineEnd   = content.indexOf('\n', Math.min(content.length, pos + 400));
      const start     = lineStart === -1 ? 0 : lineStart + 1;
      const end       = lineEnd   === -1 ? content.length : lineEnd;
      windows.add(`${start}:${end}`);
      idx = pos + word.length;
      if (windows.size >= 8) break; // cap to avoid too many extracts
    }
  }

  // Build extracted sections from windows (sorted by position)
  const sorted = [...windows]
    .map(w => { const [s, e] = w.split(':').map(Number); return { s, e }; })
    .sort((a, b) => a.s - b.s);

  const extracted = sorted.map(({ s, e }) => content.slice(s, e).trim()).join('\n…\n');

  // Always include the recent tail (most recent messages) regardless of keyword hits
  const tail    = content.slice(-600);
  const hasTail = extracted.includes(tail.slice(0, 50));

  const combined = extracted
    ? (hasTail ? extracted : `${extracted}\n\n— Recent —\n${tail}`)
    : tail;

  return combined.slice(0, maxLen);
}

// ─────────────────────────────────────────────────────────────────────────────
// getAllContext — dump recent content from all channels
// ─────────────────────────────────────────────────────────────────────────────
function getAllContext() {
  return [..._channelIndex.values()]
    .map(c => `=== #${c.name} ===\n${c.content.slice(-2000)}`)
    .join('\n\n')
    .slice(0, 12000);
}

// ─────────────────────────────────────────────────────────────────────────────
// indexChannelContent — called by mentionHandler after live channel fetch
// ─────────────────────────────────────────────────────────────────────────────
function indexChannelContent(channelId, channelName, sortedMsgs) {
  const lines = sortedMsgs.map(m => {
    const parts = [];
    const ts    = _fmtDate(m.createdTimestamp);
    const name  = m.member?.displayName || m.author.username;
    if (m.content?.trim()) parts.push(`[${ts}] ${name}: ${m.content.trim()}`);
    for (const e of m.embeds || []) {
      const ep = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean).join(' | ');
      if (ep) parts.push(`[embed] ${ep}`);
    }
    return parts.join(' ').trim();
  }).filter(Boolean);

  if (!lines.length) return;
  const existing = _channelIndex.get(channelId)?.content || '';
  const combined = existing ? existing + '\n' + lines.join('\n') : lines.join('\n');
  _channelIndex.set(channelId, { id: channelId, name: channelName, content: combined.slice(-500_000), lastScanned: new Date().toISOString() });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public getters
// ─────────────────────────────────────────────────────────────────────────────
function getCachedBrain()    { return _cachedBrain; }
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function _getTextChannels(guild) {
  if (!guild) return [];
  return [...guild.channels.cache.values()].filter(
    c => c.isTextBased() && !c.isThread() && !SKIP_IDS.has(c.id)
  );
}

function _enrichGuildMembers(brain, guild) {
  for (const [, gm] of guild.members.cache) {
    if (gm.user.bot) continue;
    const topRole = [...gm.roles.cache.values()]
      .filter(r => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)[0];

    brain.guildMembers[gm.id] = {
      id: gm.id, username: gm.user.username, displayName: gm.displayName,
      topRole: topRole?.name || 'Member',
      roles: [...gm.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => r.name).slice(0, 8),
      joinedAt: gm.joinedAt?.toISOString() || null,
    };

    if (brain.members[gm.id]) {
      brain.members[gm.id].displayName = gm.displayName;
      brain.members[gm.id].topRole     = topRole?.name || 'Member';
      brain.members[gm.id].roles       = brain.guildMembers[gm.id].roles;
    }
  }
}

function _ensureBrainShape(brain) {
  brain.facts         = brain.facts         || [];
  brain.members       = brain.members       || {};
  brain.channels      = brain.channels      || {};
  brain.relationships = brain.relationships || {};
  brain.guildMembers  = brain.guildMembers  || {};
  brain.historyScan   = brain.historyScan   || { channels: {} };
}

function _resolveSubject(raw, msg) {
  return raw
    .replace(/<@!?(\d+)>/g, (_, id) => { const u = msg.mentions.users.get(id); return u ? `@${u.username}` : `<@${id}>`; })
    .replace(/<@&(\d+)>/g,  (_, id) => { const r = msg.guild?.roles?.cache.get(id); return r ? `@${r.name}` : `<@&${id}>`; });
}

function _pushFact(brain, fact) {
  const key = JSON.stringify(fact).slice(0, 120);
  if (!brain.facts.some(f => JSON.stringify(f).slice(0, 120) === key)) brain.facts.push(fact);
}

function _fmtDate(ts) {
  return new Date(ts).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  init, scan, learnFromMessage,
  getCachedBrain, getMemberByUsername, queryBrain,
  getContextForQuery, getAllContext, getChannelIndexMap, indexChannelContent,
};
