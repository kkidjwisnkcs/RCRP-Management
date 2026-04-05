// crimeTicker.js — Auto Crime News Ticker
// Posts live crime events (kills, arrests, mod calls) as news-ticker style embeds.

'use strict';

const { EmbedBuilder } = require('discord.js');
const config           = require('../config');

let _client = null;
const postedKills     = new Set();
const postedArrests   = new Set();
const postedModCalls  = new Set();

// Simple postal → area name map for flavour
const AREA_NAMES = {
  1: 'Downtown', 2: 'Harbour', 3: 'Industrial', 4: 'Suburbs', 5: 'Highway',
  6: 'Countryside', 7: 'Airport', 8: 'Docks', 9: 'Beachfront', 10: 'Mall District',
  11: 'Old Town', 12: 'Financial', 13: 'Northside', 14: 'Southgate', 15: 'Westbrook',
  16: 'Eastwick', 17: 'Riverside', 18: 'Heights', 19: 'Midtown', 20: 'Greens',
};

function areaName(postal) {
  if (!postal) return 'Unknown Location';
  const num = parseInt(postal, 10);
  return AREA_NAMES[Math.ceil(num / 5)] || `Postal ${postal}`;
}

function timeTag() {
  return `<t:${Math.floor(Date.now() / 1000)}:T>`;
}

async function send(embed) {
  if (!_client) return;
  const ch = _client.channels.cache.get(config.channels.crimeTicker);
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(() => {});
}

async function pulse(snapshot) {
  if (!_client) return;

  const killLogs    = snapshot.killLogs    || [];
  const commandLogs = snapshot.commandLogs || [];
  const modCalls    = snapshot.modCalls    || [];

  // ── Kill events ──────────────────────────────────────────
  for (const log of killLogs.slice(-30)) {
    const key = `${log.Killer}-${log.Killed}-${log.Timestamp || ''}`;
    if (postedKills.has(key)) continue;
    postedKills.add(key);
    if (postedKills.size > 500) postedKills.delete(postedKills.values().next().value);

    const killerPlayer = (snapshot.players || []).find(p => p._username === log.Killer);
    const killedPlayer = (snapshot.players || []).find(p => p._username === log.Killed);
    const killerTeam   = killerPlayer?._team || 'Civilian';
    const killedTeam   = killedPlayer?._team || 'Civilian';

    const isLEO  = ['Police', 'Sheriff', 'SWAT'].includes(killerTeam);
    const color  = isLEO ? config.colors.blue : config.colors.danger;
    const prefix = isLEO ? '🚓 **OFFICER DOWN / ARREST**' : '💀 **BREAKING**';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${prefix} — River City Crime Ticker`)
      .setDescription(
        isLEO
          ? `Officer **${log.Killer}** (${killerTeam}) took down **${log.Killed}** (${killedTeam}) — ${timeTag()}`
          : `**${log.Killer}** eliminated **${log.Killed}** in a confrontation — ${timeTag()}`
      )
      .setFooter({ text: 'RCRP Crime Ticker — River City Role Play' })
      .setTimestamp();

    await send(embed);
  }

  // ── Arrest commands (/handcuff, :arrest, etc.) ───────────
  for (const log of commandLogs.slice(-30)) {
    const cmd = (log.Command || '').toLowerCase();
    if (!cmd.includes('arrest') && !cmd.includes('handcuff') && !cmd.includes('jail') && !cmd.includes('ticket')) continue;
    const key = `cmd-${log.Player}-${log.Command}-${log.Timestamp || ''}`;
    if (postedArrests.has(key)) continue;
    postedArrests.add(key);
    if (postedArrests.size > 300) postedArrests.delete(postedArrests.values().next().value);

    const embed = new EmbedBuilder()
      .setColor(config.colors.blue)
      .setTitle('🚨 ARREST — River City Crime Ticker')
      .setDescription(`**${log.Player || '?'}** issued \`${log.Command}\` — ${timeTag()}`)
      .setFooter({ text: 'RCRP Crime Ticker — River City Role Play' })
      .setTimestamp();

    await send(embed);
  }

  // ── Mod calls (staffed, so community can see) ────────────
  for (const call of modCalls.slice(-5)) {
    const key = `mod-${call.Caller}-${call.Timestamp || call.Message || ''}`;
    if (postedModCalls.has(key)) continue;
    postedModCalls.add(key);
    if (postedModCalls.size > 200) postedModCalls.delete(postedModCalls.values().next().value);

    const embed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('📢 MOD CALLED — Staff Responding')
      .setDescription(`A mod call was placed in River City. Staff are handling it. — ${timeTag()}`)
      .setFooter({ text: 'RCRP Crime Ticker — River City Role Play' })
      .setTimestamp();

    await send(embed);
  }
}

function init(client) {
  _client = client;
}

// Allow heartbeat to pre-seed seen keys on startup (prevents restart spam)
function seedSeen(key) { postedKills.add(key); }

module.exports = { init, pulse, seedSeen };
