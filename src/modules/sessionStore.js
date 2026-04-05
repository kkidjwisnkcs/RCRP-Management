// ============================================================
// sessionStore.js — Persistent Staff Session Storage
// Saves every completed shift as an embed in #discord-database.
// Survives bot restarts. Powers /staff staffsessions.
// ============================================================
'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

// In-memory active shifts: robloxId → { discordId, startTime, robloxUsername }
const activeShifts = new Map();

function startShift(robloxId, discordId, robloxUsername) {
  if (activeShifts.has(robloxId)) return;
  activeShifts.set(robloxId, { discordId, startTime: Date.now(), robloxUsername });
}

async function endShift(robloxId, client) {
  const shift = activeShifts.get(robloxId);
  if (!shift) return 0;
  activeShifts.delete(robloxId);

  const durationMin = Math.max(1, Math.floor((Date.now() - shift.startTime) / 60000));
  const dateStr     = new Date().toISOString().slice(0, 10);

  // Persist as embed to Discord DB
  try {
    const dbCh = client.channels.cache.get(config.channels.discordDatabase);
    if (dbCh) {
      const embed = new EmbedBuilder()
        .setTitle('📋 SESSION_LOG')
        .setColor(0x2D7D46)
        .setDescription('Staff session record for **' + shift.robloxUsername + '**')
        .addFields(
          { name: 'ROBLOX_ID',    value: String(robloxId),        inline: true },
          { name: 'DISCORD_ID',   value: String(shift.discordId), inline: true },
          { name: 'ROBLOX_NAME',  value: shift.robloxUsername,    inline: true },
          { name: 'DATE',         value: dateStr,                 inline: true },
          { name: 'DURATION_MIN', value: String(durationMin),     inline: true },
          { name: 'START_TS',     value: String(shift.startTime), inline: true },
          { name: 'END_TS',       value: String(Date.now()),      inline: true },
        )
        .setFooter({ text: 'RCRP_SESSION_RECORD' })
        .setTimestamp();
      await dbCh.send({ embeds: [embed] }).catch(() => {});
    }
  } catch { /* never crash */ }

  return durationMin;
}

function getActiveShifts() { return activeShifts; }
function isOnShift(robloxId) { return activeShifts.has(robloxId); }

// Fetch all persisted sessions. Returns Map<robloxId, { robloxUsername, discordId, sessions[] }>
async function fetchAllSessions(guild) {
  const dbCh = guild.channels.cache.get(config.channels.discordDatabase);
  if (!dbCh) return new Map();

  const result = new Map();
  let before;

  try {
    while (true) {
      const opts = { limit: 100 };
      if (before) opts.before = before;
      const batch = await dbCh.messages.fetch(opts);
      if (!batch.size) break;

      for (const msg of batch.values()) {
        const embed = msg.embeds?.[0];
        if (!embed || embed.title !== '📋 SESSION_LOG') continue;
        if (embed.footer?.text !== 'RCRP_SESSION_RECORD') continue;

        const f = {};
        for (const field of embed.fields || []) f[field.name] = field.value;

        const robloxId   = f['ROBLOX_ID'];
        const discordId  = f['DISCORD_ID'];
        const robloxName = f['ROBLOX_NAME'] || 'Unknown';
        const date       = f['DATE']        || '?';
        const durMin     = parseInt(f['DURATION_MIN'] || '0', 10);
        const startTs    = parseInt(f['START_TS']     || '0', 10);
        if (!robloxId || !durMin) continue;

        if (!result.has(robloxId)) {
          result.set(robloxId, { robloxUsername: robloxName, discordId, sessions: [] });
        }
        result.get(robloxId).sessions.push({ date, durationMin: durMin, startTs });
      }

      const oldest = [...batch.values()].reduce((a, b) => a.createdTimestamp < b.createdTimestamp ? a : b);
      before = oldest.id;
      if (batch.size < 100) break;
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (err) {
    console.error('[sessionStore] fetchAllSessions:', err.message);
  }

  return result;
}

module.exports = { startShift, endShift, getActiveShifts, isOnShift, fetchAllSessions };
