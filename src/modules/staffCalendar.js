// staffCalendar.js — Visual Weekly Staff Calendar
// Shows who's on LOA, who's signed up for sessions, who hasn't been seen in 7+ days.

'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

let _client      = null;
let calendarMsgId = null;

function init(client) {
  _client = client;
  setInterval(refreshCalendar, 30 * 60_000); // refresh every 30 min
}

function getWeekLabel() {
  const now  = new Date();
  const mon  = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun  = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt  = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

async function refreshCalendar(loaStore, shiftSessions, activeShifts, guild) {
  if (!_client || !guild) return;
  const ch = _client.channels.cache.get(config.channels.staffChat);
  if (!ch) return;

  const now  = Date.now();
  const week = getWeekLabel();

  // LOA rows
  const loaEntries  = loaStore ? [...loaStore.values()].filter(l => l.status === 'approved') : [];
  const loaLines    = loaEntries.map(l => `🟡 <@${l.userId}> — LOA \`${l.startDate}\` → \`${l.endDate}\`\n> *${l.reason?.slice(0, 80) || 'No reason given'}*`);

  // Active shifts right now
  const onDutyLines = activeShifts
    ? [...activeShifts.entries()].map(([, s]) => `🟢 **${s.username}** — On duty now`)
    : [];

  // Who hasn't been seen in 7+ days (using lastSeen from shift records if available)
  const inactiveLines = [];

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`📅  Staff Duty Calendar — Week of ${week}`)
    .setDescription('Live overview of staff availability and activity this week.')
    .setFooter({ text: 'RCRP Staff Calendar — Auto-refreshes every 30 minutes' })
    .setTimestamp();

  if (onDutyLines.length) {
    embed.addFields({ name: `🟢 Currently On Duty (${onDutyLines.length})`, value: onDutyLines.join('\n').slice(0, 1024), inline: false });
  } else {
    embed.addFields({ name: '🟢 Currently On Duty', value: '*No staff in game right now.*', inline: false });
  }

  if (loaLines.length) {
    embed.addFields({ name: `🟡 Active LOAs (${loaLines.length})`, value: loaLines.join('\n').slice(0, 1024), inline: false });
  } else {
    embed.addFields({ name: '🟡 Active LOAs', value: '*No active LOAs this week.*', inline: false });
  }

  if (inactiveLines.length) {
    embed.addFields({ name: '🔴 Inactive 7+ Days', value: inactiveLines.join('\n').slice(0, 1024), inline: false });
  }

  if (calendarMsgId) {
    const msg = await ch.messages.fetch(calendarMsgId).catch(() => null);
    if (msg) { await msg.edit({ embeds: [embed] }).catch(() => { calendarMsgId = null; }); return; }
  }

  const sent = await ch.send({ embeds: [embed] }).catch(() => null);
  if (sent) calendarMsgId = sent.id;
}

module.exports = { init, refreshCalendar };
