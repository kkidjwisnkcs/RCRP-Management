// ============================================================
// crimeTickerWall.js — Live Wanted Wall + Crime Ticker Feed
// Wanted wall: edits ONE embed every 20s (no spam).
// Crime ticker: posts new kill/event embeds (deduped).
// ============================================================
'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

let _client      = null;
let _wantedMsgId = null;
let _wantedChId  = null;
const _seenKills = new Set(); // dedup

function init(client) {
  _client     = client;
  _wantedChId = config.channels.wantedWall;
}

async function findExistingWantedWall(client) {
  _client     = client;
  _wantedChId = config.channels.wantedWall;
  try {
    const ch = client.channels.cache.get(_wantedChId);
    if (!ch) return;
    const msgs = await ch.messages.fetch({ limit: 20 });
    const existing = [...msgs.values()].find(m =>
      m.author.id === client.user.id &&
      m.embeds?.[0]?.title?.includes('CRIMINAL ACTIVITY')
    );
    if (existing) { _wantedMsgId = existing.id; }
  } catch { /* ok */ }
}

function seedSeen(players) {
  for (const p of (players || [])) {
    // seed dedup on restart so we don't re-post old kills
    if (p._userId) _seenKills.add('seed:' + p._userId);
  }
}

async function pulse(snapshot) {
  if (!_client || !snapshot) return;
  await Promise.all([
    _updateWantedWall(snapshot),
    _postCrimeTicker(snapshot),
  ]);
}

// ── Live Wanted Wall ──────────────────────────────────────
async function _updateWantedWall(snapshot) {
  try {
    const ch = _client.channels.cache.get(_wantedChId);
    if (!ch) return;

    const criminals = (snapshot.players || []).filter(p =>
      (p._team || '').toLowerCase().includes('criminal')
    );
    const leo = (snapshot.players || []).filter(p =>
      (p._team || '').toLowerCase().includes('police') ||
      (p._team || '').toLowerCase().includes('law')
    );
    const total = snapshot.players?.length || 0;
    const srv   = snapshot.server || {};

    const embed = new EmbedBuilder()
      .setColor(criminals.length > 0 ? 0xED4245 : 0x2D7D46)
      .setTitle('🚨  LIBERTY COUNTY — CRIMINAL ACTIVITY BOARD')
      .setFooter({ text: '🏙️ ' + total + ' players in-game  ·  RCRP Live Board  ·  Updates every 20s' })
      .setTimestamp();

    if (criminals.length === 0) {
      embed.setDescription('✅  **River City is clear.** No active criminals.\n*Last updated ' + new Date().toUTCString() + '*');
    } else {
      embed.setDescription(
        '**' + criminals.length + '** active criminal' + (criminals.length !== 1 ? 's' : '') +
        ' currently in River City.\n*Data ' + (require('../utils/erlc').getCacheAge?.() || '?') + 's old*'
      );
      for (const c of criminals.slice(0, 20)) {
        embed.addFields({
          name: '🔴  ' + c._username,
          value: '**Vehicle:** ' + (c._vehicle || 'On foot') + '  ·  **Callsign:** ' + (c._callsign || '—'),
          inline: false,
        });
      }
      if (criminals.length > 20) {
        embed.addFields({ name: '...', value: '+' + (criminals.length - 20) + ' more not shown', inline: false });
      }
      if (leo.length > 0) {
        embed.addFields({
          name: '🚔  LEO Response (' + leo.length + ' units)',
          value: leo.slice(0, 6).map(p => p._username + (p._callsign ? ' [' + p._callsign + ']' : '')).join(', ') +
            (leo.length > 6 ? ' +' + (leo.length - 6) + ' more' : ''),
          inline: false,
        });
      }
    }

    if (_wantedMsgId) {
      try {
        const msg = await ch.messages.fetch(_wantedMsgId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch { _wantedMsgId = null; }
    }
    const sent = await ch.send({ embeds: [embed] });
    _wantedMsgId = sent.id;
  } catch (err) {
    console.error('[WantedWall] Error:', err.message);
  }
}

// ── Crime Ticker ──────────────────────────────────────────
async function _postCrimeTicker(snapshot) {
  try {
    const tickerCh = _client.channels.cache.get(config.channels.crimeTicker);
    if (!tickerCh) return;

    for (const kill of (snapshot.killLogs || []).slice(-20)) {
      const key = (kill.Killer || '') + ':' + (kill.Killed || '') + ':' + (kill.Weapon || '') + ':' + (kill.Timestamp || '');
      if (_seenKills.has(key)) continue;
      _seenKills.add(key);
      if (_seenKills.size > 3000) _seenKills.delete(_seenKills.values().next().value);

      const ts = kill.Timestamp
        ? '<t:' + Math.floor(new Date(kill.Timestamp).getTime() / 1000) + ':T>'
        : '<t:' + Math.floor(Date.now() / 1000) + ':T>';

      const embed = new EmbedBuilder()
        .setColor(0x992D22)
        .setTitle('📰  CRIME TICKER')
        .setDescription(
          '**' + (kill.Killer || 'Unknown') + '** took down **' + (kill.Killed || 'Unknown') + '**' +
          (kill.Weapon ? ' with a **' + kill.Weapon + '**' : '') + '.'
        )
        .addFields(
          { name: '🔫 Weapon', value: kill.Weapon || 'Unknown', inline: true },
          { name: '👊 Killer', value: kill.Killer || 'Unknown', inline: true },
          { name: '💀 Victim', value: kill.Killed || 'Unknown', inline: true },
          { name: '🕐 Time',   value: ts,                       inline: true },
        )
        .setFooter({ text: 'RCRP Live Crime Feed' })
        .setTimestamp();

      await tickerCh.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error('[CrimeTicker] Error:', err.message);
  }
}

module.exports = { init, pulse, findExistingWantedWall, seedSeen };
