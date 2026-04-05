// serverBroadcast.js — Server Broadcast System
// Powers the /broadcast command.
// Sends rich, styled announcements to the announcements channel.
// Supports types: general, session, event, alert, staff, shutdown.
'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

let _client = null;

function init(client) {
  _client = client;
  console.log('[ServerBroadcast] Initialized.');
}

const BROADCAST_TYPES = {
  general:  { color: 0x1D6FA5, emoji: '📢', label: 'General Announcement',  ping: null },
  session:  { color: 0x2D7D46, emoji: '🟢', label: 'Session Announcement',   ping: 'sessionPing' },
  event:    { color: 0x8B7536, emoji: '🏆', label: 'Community Event',         ping: 'giveawayPing' },
  alert:    { color: 0xED4245, emoji: '🚨', label: 'Staff Alert',             ping: 'ssuPing' },
  staff:    { color: 0x9B59B6, emoji: '👥', label: 'Staff Announcement',      ping: null },
  shutdown: { color: 0x992D22, emoji: '🔴', label: 'Server Shutdown Notice',  ping: 'sessionPing' },
};

async function broadcast(interaction, type, title, message, targetChannel) {
  const cfg     = BROADCAST_TYPES[type] || BROADCAST_TYPES.general;
  const author  = interaction.member;
  const guild   = interaction.guild;

  const ch = targetChannel
    ? (guild.channels.cache.get(targetChannel) || guild.channels.cache.find(c => c.isTextBased() && c.name.includes(targetChannel)))
    : (guild.channels.cache.get(config.channels.announcements));

  if (!ch) {
    return interaction.editReply({ content: '❌ Could not find the target channel. Check the channel ID or name.', ephemeral: true });
  }

  // Build ping content
  let pingContent = '';
  if (cfg.ping && config.roles[cfg.ping]) {
    pingContent = `<@&${config.roles[cfg.ping]}>`;
  }

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setAuthor({
      name: `${cfg.emoji}  ${cfg.label}  —  River City Role Play`,
      iconURL: guild.iconURL({ dynamic: true }) || undefined,
    })
    .setTitle(title)
    .setDescription(message)
    .addFields(
      { name: '📣 Announced By', value: `<@${author.id}> (${author.displayName})`, inline: true },
      { name: '🕐 Posted At',    value: `<t:${Math.floor(Date.now()/1000)}:F>`,   inline: true },
    )
    .setThumbnail(guild.iconURL({ dynamic: true }) || null)
    .setFooter({ text: `RCRP Broadcast System — ${cfg.label}` })
    .setTimestamp();

  // Add image if message contains a URL that looks like an image
  const imgMatch = message.match(/https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i);
  if (imgMatch) embed.setImage(imgMatch[0]);

  try {
    await ch.send({ content: pingContent || undefined, embeds: [embed] });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2D7D46)
          .setTitle('✅  Broadcast Sent')
          .setDescription(`Your **${cfg.label}** was posted to ${ch}.`)
          .setFooter({ text: 'RCRP Broadcast System' })
          .setTimestamp()
      ]
    });

    // Log to staff logs
    const logCh = _client.channels.cache.get(config.channels.logs);
    if (logCh) {
      await logCh.send({
        embeds: [
          new EmbedBuilder()
            .setColor(cfg.color)
            .setTitle(`📢 Broadcast — ${cfg.label}`)
            .addFields(
              { name: 'Sent By',  value: `<@${author.id}>`,  inline: true },
              { name: 'Channel', value: `${ch}`,             inline: true },
              { name: 'Type',    value: cfg.label,           inline: true },
              { name: 'Title',   value: title,               inline: false },
              { name: 'Message', value: message.slice(0, 400), inline: false },
            )
            .setFooter({ text: 'RCRP Broadcast Logger' })
            .setTimestamp()
        ]
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[ServerBroadcast] error:', e.message);
    await interaction.editReply({ content: `❌ Failed to send broadcast: ${e.message}` });
  }
}

module.exports = { init, broadcast, BROADCAST_TYPES };
