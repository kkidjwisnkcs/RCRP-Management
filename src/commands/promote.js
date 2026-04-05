// ============================================================
// /promote — Staff promotion command with optional image branding
// ============================================================

const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const config  = require('../config');
const perms   = require('../utils/permissions');
const db      = require('../utils/discordDb');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a staff member to a new role with a branded announcement.')
    .addUserOption(o => o
      .setName('member')
      .setDescription('The staff member to promote')
      .setRequired(true)
    )
    .addRoleOption(o => o
      .setName('role')
      .setDescription('The new role to assign')
      .setRequired(true)
    )
    .addStringOption(o => o
      .setName('note')
      .setDescription('Optional promotion note or reason')
      .setRequired(false)
    )
    .addAttachmentOption(o => o
      .setName('image')
      .setDescription('Optional branding image for the promotion embed')
      .setRequired(false)
    ),

  async execute(interaction) {
    if (!perms.isManagement(interaction.member)) {
      return perms.denyPermission(interaction, 'Management');
    }

    await interaction.deferReply();

    const target  = interaction.options.getMember('member');
    const role    = interaction.options.getRole('role');
    const note    = interaction.options.getString('note') || null;
    const image   = interaction.options.getAttachment('image') || null;

    if (!target) {
      return interaction.editReply({ content: '❌ Could not find that member.' });
    }

    // Grant the new role
    try {
      await target.roles.add(role);
    } catch (err) {
      return interaction.editReply({
        content: `❌ Failed to assign role: ${err.message}\nMake sure RCRP Management's role is above the target role.`,
      });
    }

    // Get Roblox username from verify-db
    const verifyChannel = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
    let robloxUsername = 'Unknown';
    if (verifyChannel) {
      const { users } = await db.getVerifyDb(verifyChannel);
      const entry = users.find(u => u.discordId === target.id && u.status === 'active');
      if (entry) robloxUsername = entry.robloxUsername;
    }

    // Build promotion embed
    const embed = new EmbedBuilder()
      .setColor(config.colors.gold)
      .setTitle('🎖️  STAFF PROMOTION')
      .setDescription(
        `**Congratulations, ${target}!**\n\n` +
        `You have been promoted to **${role.name}** in River City Role Play.\n` +
        (note ? `\n> ${note}` : '')
      )
      .addFields(
        { name: '👤 Staff Member', value: `${target} (${target.user.tag})`, inline: true },
        { name: '🎮 Roblox',       value: robloxUsername,                   inline: true },
        { name: '🆙 New Role',     value: role.toString(),                  inline: true },
        { name: '👑 Promoted By',  value: interaction.user.toString(),      inline: true },
        { name: '📅 Date',         value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
      )
      .setFooter({ text: 'RCRP Management • River City Role Play — Staff Management' })
      .setTimestamp();

    if (image) {
      embed.setImage(image.url);
    }

    // Post in staff-promotion channel
    const promoChannel = interaction.guild.channels.cache.get(config.channels.staffPromotion);
    if (promoChannel) {
      await promoChannel.send({ embeds: [embed] });
    }

    // Log to logs channel
    const logsChannel = interaction.guild.channels.cache.get(config.channels.logs);
    if (logsChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('📋  Promotion Log')
        .addFields(
          { name: 'Member',    value: `${target} (${target.id})`,          inline: true },
          { name: 'New Role',  value: role.name,                            inline: true },
          { name: 'By',        value: `${interaction.user} (${interaction.user.id})`, inline: true }
        )
        .setTimestamp();
      await logsChannel.send({ embeds: [logEmbed] });
    }

    await interaction.editReply({
      content: `✅ **${target.displayName}** has been promoted to **${role.name}**!`,
    });
  },
};
