// guildMemberRemove.js — Member Leave Logger

'use strict';

const { EmbedBuilder } = require('discord.js');
const config           = require('../config');

module.exports = {
  name: 'guildMemberRemove',
  once: false,

  async execute(member, client) {
    try {
      const logCh = client.channels.cache.get(config.channels.logs);
      if (!logCh) return;

      const roleNames = member.roles.cache.map(r => r.name).filter(n => n !== '@everyone');
      const isStaff   = roleNames.some(n => !['Verified', 'Unverified', 'Member'].includes(n));

      const embed = new EmbedBuilder()
        .setColor(isStaff ? config.colors.danger : config.colors.neutral)
        .setTitle(isStaff ? '🚨  Staff Member Left Server' : '👋  Member Left Server')
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '👤 User',  value: `${member.user.tag}`, inline: true },
          { name: '🆔 ID',    value: member.id,             inline: true },
          { name: '🏷️ Had Roles', value: roleNames.length ? roleNames.join(', ').slice(0, 300) : 'None', inline: false },
        )
        .setFooter({ text: `RCRP Leave Logger — ${isStaff ? '⚠️ Staff departure' : 'Standard leave'}` })
        .setTimestamp();

      await logCh.send({ embeds: [embed] });
    } catch (err) {
      console.error('[GuildMemberRemove] Error:', err.message);
    }
  },
};
