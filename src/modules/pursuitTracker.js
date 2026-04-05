// pursuitTracker.js — ERLC Live Pursuit Tracker
// Monitors player wanted stars every heartbeat pulse.
// When a pursuit starts (stars jump to 3+), posts a live pursuit alert to MDT.
// Updates the embed in real-time. Clears when player leaves or stars drop.
'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

let _client = null;
const activePursuits = new Map(); // robloxId → { embed message, data }
const seenPursuits   = new Set(); // dedup — don't re-post ongoing pursuits

function init(client) {
  _client = client;
  console.log('[PursuitTracker] Initialized.');
}

async function pulse(snapshot) {
  if (!_client) return;
  if (!snapshot?.players?.length) return;

  const mdtCh = _client.channels.cache.get(config.channels.mdt);
  if (!mdtCh) return;

  const now = Date.now();

  // Detect NEW high-wanted players
  for (const player of snapshot.players) {
    const stars   = player._wantedStars || 0;
    const uid     = String(player._userId || player._username || '');
    const name    = player._username || player.Name || 'Unknown';
    const team    = player._team || 'Civilian';
    const postal  = player._location?.PostalCode ? `Postal ${player._location.PostalCode}` : 'Unknown';
    const vehicle = player._vehicle || 'On foot';

    if (stars >= 3 && !seenPursuits.has(uid)) {
      seenPursuits.add(uid);

      const color = stars >= 5 ? 0xED1C24 : stars >= 4 ? 0xFF6B00 : 0xFFD700;
      const starBar = '⭐'.repeat(stars) + '☆'.repeat(Math.max(0, 6 - stars));

      const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: '🚔  LIVE PURSUIT ALERT  —  RCRP MDT' })
        .setTitle(`${starBar}  ${name}  |  ${stars}★ WANTED`)
        .setDescription(
          `> **Threat Level:** ${stars >= 5 ? '🔴 EXTREME — ALL UNITS' : stars >= 4 ? '🟠 HIGH — MULTIPLE UNITS' : '🟡 ELEVATED — RESPOND WITH CAUTION'}\n` +
          `> **Status:** 🔥 Active flight from law enforcement`
        )
        .addFields(
          { name: '📍 Last Known Location', value: postal,  inline: true },
          { name: '🚗 Vehicle',             value: vehicle, inline: true },
          { name: '👥 In-Game Team',        value: team,    inline: true },
          { name: '⭐ Wanted Level',         value: `${stars} Star${stars !== 1 ? 's' : ''}`, inline: true },
          { name: '🆔 Player',              value: name,    inline: true },
          { name: '🕐 Reported',            value: `<t:${Math.floor(now/1000)}:T>`, inline: true },
        )
        .setFooter({ text: 'RCRP Pursuit Tracker — River City Role Play MDT' })
        .setTimestamp();

      try {
        const msg = await mdtCh.send({ embeds: [embed] });
        activePursuits.set(uid, { msg, stars, name });
        console.log(`[PursuitTracker] Pursuit started: ${name} (${stars}★)`);
      } catch (e) {
        console.error('[PursuitTracker] post error:', e.message);
      }
    }

    // Update existing pursuit embed if stars changed
    if (activePursuits.has(uid) && stars !== activePursuits.get(uid).stars) {
      const rec   = activePursuits.get(uid);
      const color = stars >= 5 ? 0xED1C24 : stars >= 4 ? 0xFF6B00 : 0xFFD700;
      const starBar = '⭐'.repeat(stars) + '☆'.repeat(Math.max(0, 6 - stars));
      const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: '🚔  LIVE PURSUIT ALERT  —  RCRP MDT' })
        .setTitle(`${starBar}  ${name}  |  ${stars}★ WANTED — UPDATED`)
        .addFields(
          { name: '📍 Last Known', value: postal, inline: true },
          { name: '🚗 Vehicle',    value: vehicle, inline: true },
          { name: '⭐ Stars',      value: String(stars), inline: true },
        )
        .setFooter({ text: 'RCRP Pursuit Tracker — Updated' })
        .setTimestamp();
      try { await rec.msg.edit({ embeds: [embed] }); } catch {}
      rec.stars = stars;
    }
  }

  // Clear pursuits for players who are gone or stars dropped
  const currentIds = new Set(snapshot.players.map(p => String(p._userId || p._username || '')));
  for (const [uid, rec] of activePursuits.entries()) {
    const player = snapshot.players.find(p => String(p._userId || p._username || '') === uid);
    const stars   = player?._wantedStars || 0;
    if (!currentIds.has(uid) || stars < 1) {
      // Post resolution embed
      try {
        const embed = new EmbedBuilder()
          .setColor(0x2D7D46)
          .setTitle(`✅  Pursuit Resolved — ${rec.name}`)
          .setDescription(currentIds.has(uid) ? '> Suspect cleared — wanted level dropped.' : '> Suspect left the server.')
          .setFooter({ text: 'RCRP Pursuit Tracker — River City Role Play' })
          .setTimestamp();
        await mdtCh.send({ embeds: [embed] });
        await rec.msg.edit({ content: '~~' + '' + '~~' }).catch(() => {});
      } catch {}
      activePursuits.delete(uid);
      seenPursuits.delete(uid);
    }
  }
}

function seedSeen(ids = []) {
  for (const id of ids) seenPursuits.add(id);
}

module.exports = { init, pulse, seedSeen };
