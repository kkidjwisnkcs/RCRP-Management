// ============================================================
// /sticky — Anchor a message to the bottom of a channel.
// Usage: Reply to any message with /sticky to anchor it.
// Usage: /sticky remove to clear the sticky.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const perms  = require('../utils/permissions');
const sticky = require('../modules/sticky');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Anchor a message to the bottom of this channel.')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Sticky a message by replying to it, or provide custom text.')
      .addStringOption(o => o
        .setName('text')
        .setDescription('Custom text to sticky (optional — or reply to a message instead)')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove the sticky message from this channel.')
    ),

  async execute(interaction) {
    if (!perms.isManagement(interaction.member)) {
      return perms.denyPermission(interaction, 'Management');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'remove') {
      const existing = sticky.getSticky(interaction.channelId);
      if (!existing) {
        return interaction.reply({ content: '❌ No sticky message is set in this channel.', ephemeral: true });
      }

      // Delete the sticky bot message
      try {
        const msg = await interaction.channel.messages.fetch(existing.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      } catch { /* ignore */ }

      sticky.removeSticky(interaction.channelId);
      return interaction.reply({ content: '✅ Sticky message removed.', ephemeral: true });
    }

    // sub === 'set'
    await interaction.deferReply({ ephemeral: true });

    let stickyContent = null;
    let stickyEmbeds  = [];
    let stickyFiles   = [];

    const customText = interaction.options.getString('text');

    if (customText) {
      // Use provided text
      stickyContent = customText;
    } else {
      // Try to get the replied-to message
      const reference = interaction.message?.reference || null;

      if (reference?.messageId) {
        try {
          const referencedMsg = await interaction.channel.messages.fetch(reference.messageId);
          stickyContent = referencedMsg.content || null;
          stickyEmbeds  = referencedMsg.embeds.map(e => e.toJSON()) || [];
          stickyFiles   = referencedMsg.attachments.map(a => a.url) || [];
        } catch {
          return interaction.editReply({ content: '❌ Could not fetch the referenced message.' });
        }
      } else {
        return interaction.editReply({
          content: '❌ Please either reply to a message before using `/sticky set`, or provide the `text` option.',
        });
      }
    }

    if (!stickyContent && !stickyEmbeds.length && !stickyFiles.length) {
      return interaction.editReply({ content: '❌ The message has no content to sticky.' });
    }

    // Delete existing sticky if any
    const existing = sticky.getSticky(interaction.channelId);
    if (existing) {
      try {
        const oldMsg = await interaction.channel.messages.fetch(existing.messageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      } catch { /* ignore */ }
    }

    // Post the sticky
    const sent = await interaction.channel.send({
      content: stickyContent,
      embeds:  stickyEmbeds,
      files:   stickyFiles,
    });

    sticky.setSticky(interaction.channelId, {
      content: stickyContent,
      embeds:  stickyEmbeds,
      files:   stickyFiles,
    }, sent.id);

    await interaction.editReply({ content: '✅ Sticky message set! It will stay at the bottom of this channel.' });
  },
};
