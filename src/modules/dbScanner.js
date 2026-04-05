// dbScanner.js — Full guild channel scanner for AI knowledge
// Indexes every text channel, every message (up to 100 per channel).
// Updates every 60 seconds. Provides citation-aware context to AI.

const config = require('../config');

let _client  = null;
let _running = false;
let _lastScan = 0;

// channelId → { name, id, content, embeds, lastScanned }
const channelIndex = new Map();

function start(discordClient) {
  if (_running) return;
  _running = true;
  _client  = discordClient;
  console.log('[DBScanner] Started — indexing all guild channels every 60s.');
  // Delay first scan 8 seconds to let guild cache populate
  setTimeout(() => {
    scan();
    setInterval(scan, config.dbScanInterval);
  }, 8000);
}

async function scan() {
  try {
    const guild = _client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;

    // Fetch all text-based channels
    const channels = guild.channels.cache.filter(c =>
      (c.type === 0 || c.type === 5 || c.type === 15) && c.viewable
    );

    let indexed = 0;
    for (const [, ch] of channels) {
      try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        const textParts = [];
        for (const m of sorted) {
          // Get plain text
          if (m.content?.trim()) textParts.push(m.content.trim());
          // Get embed text (title + description + fields)
          for (const e of m.embeds || []) {
            const parts = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean);
            if (parts.length) textParts.push(parts.join('\n'));
          }
        }

        const combined = textParts.filter(Boolean).join('\n').trim();
        if (combined.length > 0) {
          channelIndex.set(ch.id, {
            id:          ch.id,
            name:        ch.name,
            content:     combined,
            charCount:   combined.length,
            lastScanned: new Date().toISOString(),
          });
          indexed++;
        }
      } catch { /* no access, skip */ }
    }

    _lastScan = Date.now();
    console.log(`[DBScanner] ✅ Indexed ${indexed}/${channels.size} channels (${[...channelIndex.values()].reduce((a, c) => a + c.charCount, 0)} chars total)`);
  } catch (err) {
    console.error('[DBScanner] scan error:', err.message);
  }
}

// On-demand scan for a single channel — called by mention handler for freshness
async function scanChannel(channelId) {
  try {
    const ch = _client.channels.cache.get(channelId);
    if (!ch) return;
    const msgs = await ch.messages.fetch({ limit: 100 });
    const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const textParts = [];
    for (const m of sorted) {
      if (m.content?.trim()) textParts.push(m.content.trim());
      for (const e of m.embeds || []) {
        const parts = [e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`)].filter(Boolean);
        if (parts.length) textParts.push(parts.join('\n'));
      }
    }
    const combined = textParts.filter(Boolean).join('\n').trim();
    if (combined.length) channelIndex.set(ch.id, { id: ch.id, name: ch.name, content: combined, charCount: combined.length, lastScanned: new Date().toISOString() });
  } catch {}
}

// Trigger immediate scan if not scanned recently
async function ensureIndexed() {
  if (!_client) return;
  if (!_lastScan || Date.now() - _lastScan > 30000) {
    console.log('[DBScanner] On-demand scan triggered...');
    await scan();
  }
}

// Return citation-annotated context most relevant to the query
function getContextForQuery(query) {
  if (channelIndex.size === 0) {
    return 'Channel index is empty — either the bot just started (takes up to 8 seconds) or all channels are inaccessible.';
  }

  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored = [...channelIndex.values()].map(ch => {
    const haystack = (ch.name + ' ' + ch.content).toLowerCase();
    const score    = qWords.reduce((acc, w) => acc + (haystack.split(w).length - 1), 0);
    return { ...ch, score };
  }).filter(c => c.score > 0 || /rule|info|announce|guide|faq|handbook/i.test(c.name))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!scored.length) {
    // Return top informational channels as fallback
    const fallback = [...channelIndex.values()]
      .filter(c => /rule|info|announce|guide|faq|welcome/i.test(c.name))
      .slice(0, 4);
    if (!fallback.length) {
      return [...channelIndex.values()].slice(0, 3).map(c => `[Source: #${c.name} | <#${c.id}>]\n${c.content.slice(0, 800)}`).join('\n\n---\n\n');
    }
    return fallback.map(c => `[Source: #${c.name} | <#${c.id}>]\n${c.content.slice(0, 1200)}`).join('\n\n---\n\n');
  }

  return scored.map(c => `[Source: #${c.name} | <#${c.id}>]\n${c.content.slice(0, 1200)}`).join('\n\n---\n\n');
}

// Return all indexed content (for broad queries)
function getAllContext() {
  return [...channelIndex.values()].map(c => `=== #${c.name} ===\n${c.content.slice(0, 2000)}`).join('\n\n').slice(0, 12000);
}

function getServerContext() { return getAllContext(); }
function getChannelIndex() { return channelIndex; }

module.exports = { start, scan, ensureIndexed, scanChannel, getContextForQuery, getAllContext, getServerContext, getChannelIndex };
