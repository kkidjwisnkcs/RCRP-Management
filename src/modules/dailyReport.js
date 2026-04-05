// dailyReport.js — Daily City Report
// Posts a rich daily summary to staff chat every night at midnight.

'use strict';

const { EmbedBuilder } = require('discord.js');
const config           = require('../config');

let _client = null;
let _stats  = {
  totalPlayers:    0,
  peakPlayers:     0,
  peakTime:        null,
  sessionsToday:   0,
  killsToday:      0,
  arresToday:      0,
  teamCounts:      {},
  hourlyBuckets:   {},
  dayStart:        new Date().toDateString(),
};

function resetStats() {
  _stats = {
    totalPlayers:  0,
    peakPlayers:   0,
    peakTime:      null,
    sessionsToday: 0,
    killsToday:    0,
    arresToday:    0,
    teamCounts:    {},
    hourlyBuckets: {},
    dayStart:      new Date().toDateString(),
  };
}

function track(snapshot) {
  const today = new Date().toDateString();
  if (_stats.dayStart !== today) resetStats();

  const playerCount = (snapshot.players || []).length;
  if (playerCount > _stats.peakPlayers) {
    _stats.peakPlayers = playerCount;
    _stats.peakTime    = new Date().toLocaleTimeString();
  }

  // Track unique players using Set (stored by username)
  if (!_stats._seenPlayers) _stats._seenPlayers = new Set();
  for (const p of (snapshot.players || [])) {
    _stats._seenPlayers.add(p._username);
    if (p._team) _stats.teamCounts[p._team] = (_stats.teamCounts[p._team] || 0) + 1;
  }
  _stats.totalPlayers = _stats._seenPlayers.size;

  // Count kills (rough estimate from accumulated kill logs)
  _stats.killsToday = (snapshot.killLogs || []).length;

  // Hourly bucket
  const hour = new Date().getHours();
  _stats.hourlyBuckets[hour] = Math.max(_stats.hourlyBuckets[hour] || 0, playerCount);
}

async function postDailyReport() {
  if (!_client) return;
  const ch = _client.channels.cache.get(config.channels.cityReport);
  if (!ch) return;

  const topTeam = Object.entries(_stats.teamCounts).sort((a, b) => b[1] - a[1])[0];
  const busiest = Object.entries(_stats.hourlyBuckets).sort((a, b) => b[1] - a[1])[0];
  const busiestLabel = busiest ? `${busiest[0]}:00 – ${busiest[0] < 23 ? parseInt(busiest[0]) + 1 : 0}:00` : 'N/A';

  const embed = new EmbedBuilder()
    .setColor(config.colors.gold)
    .setTitle('📊  Daily City Report — River City')
    .setDescription(`Here's what happened in River City on **${_stats.dayStart}**`)
    .addFields(
      { name: '👥 Unique Players', value: String(_stats.totalPlayers),              inline: true },
      { name: '📈 Peak Players',   value: `${_stats.peakPlayers} at ${_stats.peakTime || 'N/A'}`, inline: true },
      { name: '🕐 Busiest Hour',   value: busiestLabel,                              inline: true },
      { name: '💀 Kills Logged',   value: String(_stats.killsToday),                inline: true },
      { name: '🏆 Most Active Team', value: topTeam ? `${topTeam[0]} (${topTeam[1]} appearances)` : 'N/A', inline: true },
      { name: '📅 Report Date',    value: _stats.dayStart,                           inline: true },
    )
    .setFooter({ text: 'RCRP Daily Report — Auto-generated at midnight' })
    .setTimestamp();

  await ch.send({ content: '<@&' + (config.roles.staffSupervisor || '') + '> Daily city report is in.', embeds: [embed] }).catch(() =>
    ch.send({ embeds: [embed] }).catch(() => {})
  );

  resetStats();
}

function scheduleMidnightReport() {
  const now         = new Date();
  const midnight    = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntil     = midnight - now;
  setTimeout(() => {
    postDailyReport();
    setInterval(postDailyReport, 24 * 60 * 60 * 1000);
  }, msUntil);
  console.log(`[DailyReport] Scheduled — ${Math.round(msUntil / 60000)} minutes until midnight`);
}

function init(client) {
  _client = client;
  scheduleMidnightReport();
}

module.exports = { init, track, postDailyReport };
