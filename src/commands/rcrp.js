// /rcrp — Owner-only bot management & unified setup
  const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const config       = require('../config');
  const perms        = require('../utils/permissions');
  const dbScanner    = require('../modules/dbScanner');
  const shiftCards   = require('../modules/shiftCards');
  const erlc         = require('../utils/erlc');
  const embeds       = require('../utils/embeds');
  const verification = require('../modules/verification');
  const applications = require('../modules/applications');

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('rcrp')
      .setDescription('RCRP Management bot commands (Owner/Management only).')
      .addSubcommand(sub => sub
        .setName('index')
        .setDescription('Force re-index all rules channels to update AI knowledge.')
      )
      .addSubcommand(sub => sub
        .setName('status')
        .setDescription('Show bot status, ERLC cache, and system info.')
      )
      .addSubcommand(sub => sub
        .setName('setup')
        .setDescription('Post or re-post any bot panel in the correct channel.')
        .addStringOption(opt => opt
          .setName('panel')
          .setDescription('Which panel to post')
          .setRequired(true)
          .addChoices(
            { name: 'Verification Panel',      value: 'verify' },
            { name: 'Staff Applications',      value: 'apps' },
            { name: 'Self-Roles Panel',        value: 'selfroles' },
            { name: 'Staff Review Panel',      value: 'review' },
            { name: 'Shift Cards (re-init)',   value: 'shifts' },
          )
        )
      ),

    async execute(interaction) {
      if (!perms.isManagement(interaction.member) && !perms.isOwner(interaction.member)) {
        return perms.denyPermission(interaction, 'Management');
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'index') {
        await interaction.deferReply({ ephemeral: true });
        await dbScanner.scan?.() || dbScanner.start?.(interaction.client);
        const context = dbScanner.getServerContext();
        return interaction.editReply({ content: 'Knowledge index updated! Context: **' + context.length.toLocaleString() + '** characters indexed.' });
      }

      if (sub === 'status') {
        await interaction.deferReply({ ephemeral: true });
        const snapshot    = erlc.getCachedSnapshot();
        const cacheAge    = erlc.getCacheAge();
        const context     = dbScanner.getServerContext();
        const playerCount = snapshot?.players?.length ?? 'N/A';
        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('RCRP Management System Status')
          .addFields(
            { name: '🟢 Bot Status',        value: 'Online',                                   inline: true },
            { name: '📡 ERLC Cache Age',    value: cacheAge >= 0 ? (cacheAge + 's ago') : 'N/A', inline: true },
            { name: '👥 Players In-Game',   value: String(playerCount),                         inline: true },
            { name: '🚨 Active 911 Calls',  value: String(snapshot?.emergencyCalls?.length ?? 0), inline: true },
            { name: '📞 Active Mod Calls',  value: String(snapshot?.modCalls?.length ?? 0),     inline: true },
            { name: '📚 AI Context',        value: context.length.toLocaleString() + ' chars',  inline: true },
            { name: '🚗 Vehicles In-Game',  value: String(snapshot?.vehicles?.length ?? 0),     inline: true },
            { name: '⚙️ Architecture',      value: 'Discord-as-Database (zero-persistence)',    inline: false },
          )
          .setFooter({ text: 'RCRP Management — River City Role Play' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      if (sub === 'setup') {
        await interaction.deferReply({ ephemeral: true });
        const panel = interaction.options.getString('panel');
        const guild = interaction.guild;
        const client = interaction.client;

        if (panel === 'verify') {
          const ch = guild.channels.cache.find(c => c.isTextBased() && /^verify(?!.*(?:database|db))/i.test(c.name)) || interaction.channel;
          await verification.postVerifyPanel(ch);
          return interaction.editReply({ content: 'Verification panel posted in <#' + ch.id + '>.' });
        }

        if (panel === 'apps') {
          const ch = guild.channels.cache.get(config.channels.staffApplications) || interaction.channel;
          await applications.postApplicationPanel(ch);
          return interaction.editReply({ content: 'Staff application panel posted in <#' + ch.id + '>.' });
        }

        if (panel === 'selfroles') {
          const ch = guild.channels.cache.get(config.channels.selfRoles);
          if (!ch) return interaction.editReply({ content: 'Self-roles channel not found (ID: ' + config.channels.selfRoles + ').' });

          const { roles } = config;
          const deptRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('selfrole:' + roles.leo).setLabel('LEO').setEmoji('🚓').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('selfrole:' + roles.fireDept).setLabel('Fire Dept').setEmoji('🚒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('selfrole:' + roles.dot).setLabel('DOT').setEmoji('🚧').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('selfrole:' + roles.civilian).setLabel('Civilian').setEmoji('🚲').setStyle(ButtonStyle.Secondary),
          );
          const pingRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('selfrole:' + roles.sessionPing).setLabel('Session Pings').setEmoji('🔔').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('selfrole:' + roles.giveawayPing).setLabel('Giveaway Pings').setEmoji('🎉').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('selfrole:' + roles.mediaPing).setLabel('Media Pings').setEmoji('📸').setStyle(ButtonStyle.Success),
          );
          await ch.send({ embeds: [embeds.selfRolesPanel()], components: [deptRow, pingRow] });
          return interaction.editReply({ content: 'Self-roles panel posted in <#' + ch.id + '>.' });
        }

        if (panel === 'review') {
          const ch = guild.channels.cache.get(config.channels.staffReview);
          if (!ch) return interaction.editReply({ content: 'Staff review channel not found (ID: ' + config.channels.staffReview + ').' });
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('leave_review').setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Primary)
          );
          await ch.send({ embeds: [embeds.reviewPanel()], components: [row] });
          return interaction.editReply({ content: 'Staff review panel posted in <#' + ch.id + '>.' });
        }

        if (panel === 'shifts') {
          await shiftCards.init(client);
          return interaction.editReply({ content: 'Shift cards reset. Live cards will appear in <#' + config.channels.shiftCards + '> as staff join the game.' });
        }

        return interaction.editReply({ content: 'Unknown panel option.' });
      }
    },
  };
  