// promote.js — /promote command
  // Grants new role, optionally removes old role, DMs the member, posts to promotion channel.
  'use strict';

  const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
  const config = require('../config');
  const perms  = require('../utils/permissions');
  const db     = require('../utils/discordDb');

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('promote')
      .setDescription('Promote a staff member with a branded announcement.')
      .addUserOption(o => o.setName('member').setDescription('The staff member to promote').setRequired(true))
      .addRoleOption(o => o.setName('new_role').setDescription('The new role to grant').setRequired(true))
      .addRoleOption(o => o.setName('old_role').setDescription('The previous role to remove').setRequired(false))
      .addStringOption(o => o.setName('note').setDescription('Promotion note or message').setRequired(false))
      .addAttachmentOption(o => o.setName('image').setDescription('Branded image for the promotion embed').setRequired(false)),

    async execute(interaction) {
      if (!perms.isManagement(interaction.member)) {
        return perms.denyPermission(interaction, 'Management');
      }

      await interaction.deferReply();

      const target  = interaction.options.getMember('member');
      const newRole = interaction.options.getRole('new_role');
      const oldRole = interaction.options.getRole('old_role') || null;
      const note    = interaction.options.getString('note') || null;
      const image   = interaction.options.getAttachment('image') || null;

      if (!target) return interaction.editReply({ content: 'Could not find that member in this server.' });

      // Role swap
      try {
        if (oldRole && target.roles.cache.has(oldRole.id)) await target.roles.remove(oldRole);
        await target.roles.add(newRole);
      } catch (e) {
        return interaction.editReply({
          content: 'Failed to assign role: ' + e.message + '. Make sure the bot role is above the target role.',
        });
      }

      // Roblox username lookup
      let robloxName = 'Unknown';
      try {
        const verCh = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
        if (verCh) {
          const { users } = await db.getVerifyDb(verCh);
          const entry = users.find(u => u.discordId === target.id && u.status === 'active');
          if (entry) robloxName = entry.robloxUsername;
        }
      } catch {}

      const ts = Math.floor(Date.now() / 1000);

      // Promotion embed (posted publicly)
      const promoEmbed = new EmbedBuilder()
        .setColor(config.colors.gold)
        .setTitle('Staff Promotion — Florida State Roleplay')
        .setDescription(
          'Congratulations, ' + target.toString() + '!\n\n' +
          'You have been promoted to **' + newRole.name + '** in Florida State Roleplay.' +
          (note ? ('\n\n> ' + note) : '')
        )
        .addFields(
          { name: 'Staff Member', value: target.toString() + ' (' + target.user.tag + ')', inline: true },
          { name: 'Roblox',       value: robloxName,                                       inline: true },
          { name: 'New Role',     value: newRole.toString(),                                inline: true },
          { name: 'Promoted By',  value: interaction.user.toString(),                       inline: true },
          { name: 'Date',         value: '<t:' + ts + ':F>',                                inline: true },
        )
        .setFooter({ text: 'FSRP Management — Florida State Roleplay' })
        .setTimestamp();

      if (image) promoEmbed.setImage(image.url);

      // Post in staff promotion channel
      const promoCh = interaction.guild.channels.cache.get(config.channels.staffPromotion);
      if (promoCh) await promoCh.send({ embeds: [promoEmbed] }).catch(() => {});

      // DM the promoted member
      let dmSent = false;
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(config.colors.gold)
          .setTitle('Congratulations! You have been promoted.')
          .setDescription(
            'You have been promoted to **' + newRole.name + '** in **Florida State Roleplay**.' +
            (note ? ('\n\n> ' + note) : '') +
            '\n\nYour new role has been applied. Continue upholding FSRP standards.'
          )
          .setFooter({ text: 'FSRP Management — Florida State Roleplay' })
          .setTimestamp();
        await target.user.send({ embeds: [dmEmbed] });
        dmSent = true;
      } catch {}

      // Log
      const logCh = interaction.guild.channels.cache.get(config.channels.logs);
      if (logCh) {
        await logCh.send({ embeds: [new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle('Promotion Log')
          .addFields(
            { name: 'Member', value: target.toString() + ' (' + target.id + ')', inline: true },
            { name: 'New Role', value: newRole.name, inline: true },
            { name: 'Old Role', value: oldRole ? oldRole.name : 'N/A', inline: true },
            { name: 'By', value: interaction.user.toString(), inline: true },
            { name: 'Note', value: note || 'None', inline: false },
          )
          .setTimestamp()
        ] }).catch(() => {});
      }

      return interaction.editReply({
        content: target.displayName + ' has been promoted to **' + newRole.name + '**!' + (dmSent ? '' : ' (DMs disabled — could not notify them)'),
      });
    },
  };
  