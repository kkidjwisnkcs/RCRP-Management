// fsrp.js — Owner/Management bot management
  'use strict';

  const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
  const config       = require('../config');
  const perms        = require('../utils/permissions');
  const dbScanner    = require('../modules/dbScanner');
  const erlc         = require('../utils/erlc');
  const autoSetup    = require('../modules/autoSetup');
  const serverBrain  = require('../modules/serverBrain');

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('fsrp')
      .setDescription('FSRP Management bot commands (Owner/Management only).')
      .addSubcommand(sub => sub
        .setName('status')
        .setDescription('Show bot status, ERLC cache, and live system info.')
      )
      .addSubcommand(sub => sub
        .setName('refresh')
        .setDescription('Force re-post and update all bot panels in their channels.')
      )
      .addSubcommand(sub => sub
        .setName('index')
        .setDescription('Force re-index all channels to update AI knowledge base.')
      ),

    async execute(interaction) {
      if (!perms.isManagement(interaction.member) && !perms.isOwner(interaction.member)) {
        return perms.denyPermission(interaction, 'Management');
      }

      const sub = interaction.options.getSubcommand();

      // ── /fsrp status ──────────────────────────────────────────────────────
      if (sub === 'status') {
        await interaction.deferReply({ ephemeral: true });
        const snapshot    = erlc.getCachedSnapshot();
        const cacheAge    = erlc.getCacheAge();
        const context     = dbScanner.getServerContext();
        const brainStats  = serverBrain.getBrainStats ? serverBrain.getBrainStats() : null;
        const playerCount = snapshot ? snapshot.players.length : 'N/A';
        const stale       = snapshot && snapshot._stale ? ' *(stale)*' : '';

        const fields = [
          { name: 'Bot Status',       value: '🟢 Online',                                             inline: true },
          { name: 'ERLC Cache',       value: cacheAge >= 0 ? cacheAge + 's ago' + stale : 'N/A',      inline: true },
          { name: 'Players In-Game',  value: String(playerCount),                                      inline: true },
          { name: '911 Calls',        value: String(snapshot ? snapshot.emergencyCalls.length : 0),    inline: true },
          { name: 'Mod Calls',        value: String(snapshot ? snapshot.modCalls.length : 0),          inline: true },
          { name: 'AI Context',       value: context.length.toLocaleString() + ' chars',               inline: true },
        ];

        if (brainStats) {
          fields.push(
            { name: 'Brain Channels',  value: String(brainStats.channelCount  || 0), inline: true },
            { name: 'Brain Members',   value: String(brainStats.memberCount   || 0), inline: true },
            { name: 'Brain Facts',     value: String(brainStats.factCount     || 0), inline: true },
          );
        }

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('FSRP Management — System Status')
          .addFields(fields)
          .setFooter({ text: 'FSRP Management Bot — Florida State Roleplay' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // ── /fsrp refresh ─────────────────────────────────────────────────────
      if (sub === 'refresh') {
        await interaction.deferReply({ ephemeral: true });
        const start = Date.now();
        await autoSetup.run(interaction.client, interaction.guild);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        return interaction.editReply({
          content: '✅ All panels refreshed in **' + elapsed + 's**. Every channel now has the latest embed.',
        });
      }

      // ── /fsrp index ───────────────────────────────────────────────────────
      if (sub === 'index') {
        await interaction.deferReply({ ephemeral: true });
        await dbScanner.scan ? dbScanner.scan() : dbScanner.start(interaction.client);
        const context = dbScanner.getServerContext();
        return interaction.editReply({
          content: '✅ Knowledge index updated. **' + context.length.toLocaleString() + '** characters indexed across all channels.',
        });
      }
    },
  };
  