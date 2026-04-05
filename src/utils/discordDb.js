// ============================================================
// discordDb.js — Discord-as-Database Utility
// Reads and writes JSON files to/from Discord channels.
// Files saved every 2 minutes (not per message).
// Survives bot restarts — keeps editing existing files.
// ============================================================

const { AttachmentBuilder } = require('discord.js');

// In-memory cache: channelId → { data, messageId, lastSaved }
const cache = new Map();

// ── Read latest file matching optional prefix ──────────────
async function readLatestFile(channel, prefix = null) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const sorted   = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    for (const msg of sorted) {
      for (const att of msg.attachments.values()) {
        if (!att.name.endsWith('.json')) continue;
        if (prefix && !att.name.startsWith(prefix)) continue;
        try {
          const response = await fetch(att.url);
          if (!response.ok) continue;
          const data = await response.json();
          return { data, message: msg };
        } catch { /* corrupt, skip */ }
      }
    }
    return { data: null, message: null };
  } catch (err) {
    console.error(`[discordDb] readLatestFile error in ${channel?.id}:`, err.message);
    return { data: null, message: null };
  }
}

// ── Write a file attachment to a channel ──────────────────
async function writeFile(channel, data, filename, content = '') {
  const buffer     = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: filename });
  return channel.send({ content, files: [attachment] });
}

// ── Read ALL files via full pagination ────────────────────
// Paginates through every message in the channel, not just the latest 100.
// prefix: only return files whose names start with this string (optional)
// maxResults: stop after collecting this many matching files (optional, 0 = all)
async function readAllFiles(channel, prefix = null, maxResults = 0) {
  const results = [];
  let   before  = undefined;

  try {
    while (true) {
      const opts = { limit: 100 };
      if (before) opts.before = before;

      const batch = await channel.messages.fetch(opts);
      if (!batch.size) break;

      // Process this batch
      for (const msg of batch.values()) {
        for (const att of msg.attachments.values()) {
          if (!att.name.endsWith('.json')) continue;
          if (prefix && !att.name.startsWith(prefix)) continue;
          try {
            const resp = await fetch(att.url);
            if (!resp.ok) continue;
            const data = await resp.json();
            results.push({ data, filename: att.name, timestamp: msg.createdTimestamp, messageId: msg.id });
          } catch { /* skip corrupt files */ }
        }
      }

      // Stop if we have enough
      if (maxResults > 0 && results.length >= maxResults) break;

      // Move cursor to the oldest message in this batch
      const oldest = [...batch.values()].reduce((a, b) => a.createdTimestamp < b.createdTimestamp ? a : b);
      before = oldest.id;

      // Reached end of channel history
      if (batch.size < 100) break;

      // Brief pause to avoid rate limits on large channels
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.error(`[discordDb] readAllFiles error in ${channel?.id}:`, err.message);
  }

  // Return sorted oldest-first
  return results.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Get next sequential file ID from channel ──────────────
async function getNextFileId(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    let maxId = 0;
    for (const msg of messages.values()) {
      for (const att of msg.attachments.values()) {
        const match = att.name.match(/^(\d{6})-/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxId) maxId = num;
        }
      }
    }
    return String(maxId + 1).padStart(6, '0');
  } catch {
    return '000001';
  }
}

// ── Write a game snapshot file ─────────────────────────────
async function writeGameSnapshot(channel, data) {
  const id      = await getNextFileId(channel);
  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
  const filename = `${id}-${dateStr}-${timeStr}.json`;
  const payload  = {
    _meta: { fileId: id, timestamp: now.toISOString(), source: 'ERLC API Heartbeat' },
    ...data,
  };
  return writeFile(channel, payload, filename, `\`${filename}\` — RCRP Game Snapshot`);
}

// ── Verify Database ───────────────────────────────────────
// Single master file pattern — always reads the latest, edits in place if possible.

async function getVerifyDb(channel) {
  const cached = cache.get(`verify:${channel.id}`);
  if (cached) {
    return { users: cached.data.users || [], save: makeVerifySave(channel, cached) };
  }

  const { data, message } = await readLatestFile(channel, 'verify-db');
  const users = data?.users || [];

  const entry = { data: { users }, messageId: message?.id || null, lastSaved: 0 };
  cache.set(`verify:${channel.id}`, entry);
  return { users, save: makeVerifySave(channel, entry) };
}

function makeVerifySave(channel, entry) {
  return async () => {
    const buffer     = Buffer.from(JSON.stringify({ users: entry.data.users }, null, 2), 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: 'verify-db.json' });
    const msg = await channel.send({ content: '`verify-db.json` — Verify Database', files: [attachment] });
    entry.messageId  = msg.id;
    entry.lastSaved  = Date.now();
  };
}

// ── Discord Brain — single living knowledge file ──────────
// Reads the latest server-brain.json, merges updates, and posts a new version.
async function getBrainFile(channel) {
  const { data } = await readLatestFile(channel, 'server-brain');
  return data || { _meta: { lastScan: null, version: 1 }, facts: [], members: {}, channels: {}, relationships: {} };
}

async function saveBrainFile(channel, brain) {
  brain._meta.lastScan  = new Date().toISOString();
  brain._meta.version   = (brain._meta.version || 0) + 1;
  const buffer     = Buffer.from(JSON.stringify(brain, null, 2), 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: 'server-brain.json' });
  return channel.send({ content: '`server-brain.json` — RCRP Server Brain', files: [attachment] });
}

// ── Discord Database — Server Snapshots ───────────────────
const _discordDbState = { lastWriteTime: 0, currentData: {} };

async function updateDiscordDbEntry(channel, key, value) {
  _discordDbState.currentData[key] = value;
  _discordDbState.currentData._updatedAt = new Date().toISOString();
  const now = Date.now();
  if (now - _discordDbState.lastWriteTime >= 120_000) {
    await flushDiscordDb(channel);
  }
}

async function flushDiscordDb(channel) {
  try {
    const now     = new Date();
    const payload = {
      _meta: { timestamp: now.toISOString(), source: 'RCRP Discord DB' },
      ..._discordDbState.currentData,
    };
    const fname = `discord-db-${now.toISOString().slice(0,16).replace('T','-').replace(':','')}.json`;
    await writeFile(channel, payload, fname, `\`${fname}\` — Discord Database Snapshot`);
    _discordDbState.lastWriteTime = Date.now();
    console.log('[discordDb] Discord DB flushed.');
  } catch (err) {
    console.error('[discordDb] flushDiscordDb error:', err.message);
  }
}

module.exports = {
  readLatestFile,
  writeFile,
  readAllFiles,
  getNextFileId,
  writeGameSnapshot,
  getVerifyDb,
  updateDiscordDbEntry,
  flushDiscordDb,
  getBrainFile,
  saveBrainFile,
};
