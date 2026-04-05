// community.js — Community Commands
  // /mystats  /where  /mycar  /scenario  /vouch
  // All player-facing commands that query the live ERLC snapshot.
  'use strict';

  const {
    SlashCommandBuilder, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
  } = require('discord.js');
  const config = require('../config');
  const db     = require('../utils/discordDb');

  // ── Verify DB lookup ────────────────────────────────────────
  async function getVerifiedRoblox(guild, discordId) {
    try {
      const ch = guild.channels.cache.get(config.channels.verifyDatabase);
      if (!ch) return null;
      const { users } = await db.getVerifyDb(ch);
      const entry = (users || []).find(u => u.discordId === discordId && u.status === 'active');
      return entry?.robloxUsername || null;
    } catch { return null; }
  }

  // ── Get latest ERLC snapshot ────────────────────────────────
  async function getLatestSnapshot(guild) {
    try {
      const ch = guild.channels.cache.get(config.channels.gameDatabase);
      if (!ch) return null;
      const { data } = await db.readLatestFile(ch, null);
      return data;
    } catch { return null; }
  }

  // ── Vouch store (simple, kept in memory + vouch board) ─────
  const vouchCooldowns = new Map(); // discordId -> timestamp

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('community')
      .setDescription('Community commands — stats, location, car info, scenarios & vouches.')
      .addSubcommand(sub => sub
        .setName('mystats')
        .setDescription('View your in-game stats from the live ERLC snapshot.')
      )
      .addSubcommand(sub => sub
        .setName('where')
        .setDescription('Find where a specific player is on the server right now.')
        .addStringOption(o => o.setName('username').setDescription('Roblox username to locate').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('mycar')
        .setDescription('View your current vehicle info from the live ERLC snapshot.')
      )
      .addSubcommand(sub => sub
        .setName('scenario')
        .setDescription('Suggest a roleplay scenario for the community.')
        .addStringOption(o => o.setName('title').setDescription('Scenario title e.g. Bank Heist').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Describe the scenario in detail').setRequired(true))
        .addStringOption(o => o.setName('roles').setDescription('Roles involved e.g. 2 Robbers, 3 LEO, 1 EMS').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('vouch')
        .setDescription('Vouch for a community member to recognize their great RP.')
        .addUserOption(o => o.setName('member').setDescription('The Discord member to vouch for').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Why are you vouching for them?').setRequired(true))
      ),

    async execute(interaction) {
      const sub   = interaction.options.getSubcommand();
      const guild = interaction.guild;

      await interaction.deferReply({ ephemeral: ['mystats','mycar'].includes(sub) });

      // ── /community mystats ──────────────────────────────────
      if (sub === 'mystats') {
        const robloxUser = await getVerifiedRoblox(guild, interaction.user.id);
        if (!robloxUser) {
          return interaction.editReply({
            content: '❌ You are not verified. Please use </verify:0> first to link your Roblox account.',
          });
        }

        const snapshot = await getLatestSnapshot(guild);
        if (!snapshot) {
          return interaction.editReply({ content: '⚠️ No snapshot data available. The bot may be initialising.' });
        }

        // Find player in snapshot
        const player = (snapshot.players || []).find(p =>
          (p._username || '').toLowerCase() === robloxUser.toLowerCase()
        );

        if (!player) {
          return interaction.editReply({
            content: '**' + robloxUser + '** is not currently on the server. Stats are only available while you are in-game.',
          });
        }

        const loc    = player._location;
        const locStr = loc
          ? 'Postal **' + (loc.PostalCode || '?') + '** — ' + (loc.StreetName || '?') + ' (' + (loc.Zone || '?') + ')'
          : 'Location unknown';
        const health = (player._health != null) ? Math.round(player._health) + '%' : 'N/A';
        const armor  = (player._armor  != null) ? Math.round(player._armor)  + '%' : 'N/A';
        const veh    = player._vehicle
          ? (player._vehicleColor ? player._vehicleColor.split('(')[0].trim() + ' ' : '') +
            player._vehicle + (player._vehiclePlate ? ' [' + player._vehiclePlate + ']' : '')
          : 'On foot';
        const team   = player._team || 'Civilian';
        const wanted = player._wantedStars ? '⭐'.repeat(Math.min(player._wantedStars, 5)) + ' (' + player._wantedStars + ' stars)' : '✅ Clean';

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('📊 Your In-Game Stats — ' + robloxUser)
          .setDescription('Live data from the River City server snapshot.')
          .addFields(
            { name: '🏷️ Team',     value: team,   inline: true },
            { name: '❤️ Health',   value: health, inline: true },
            { name: '🛡️ Armor',   value: armor,  inline: true },
            { name: '📍 Location', value: locStr, inline: false },
            { name: '🚗 Vehicle',  value: veh,    inline: false },
            { name: '🔴 Wanted',   value: wanted, inline: true },
            { name: '🔑 Permission', value: player.permission || 'Standard', inline: true },
          )
          .setFooter({ text: 'RCRP Live Stats  •  Data from last snapshot  •  ' + robloxUser })
          .setTimestamp(new Date(snapshot._meta?.timestamp || Date.now()));

        return interaction.editReply({ embeds: [embed] });
      }

      // ── /community mycar ────────────────────────────────────
      if (sub === 'mycar') {
        const robloxUser = await getVerifiedRoblox(guild, interaction.user.id);
        if (!robloxUser) {
          return interaction.editReply({ content: '❌ Not verified. Use </verify:0> first.' });
        }

        const snapshot = await getLatestSnapshot(guild);
        if (!snapshot) return interaction.editReply({ content: '⚠️ No snapshot data available.' });

        const player = (snapshot.players || []).find(p =>
          (p._username || '').toLowerCase() === robloxUser.toLowerCase()
        );

        if (!player) {
          return interaction.editReply({ content: '**' + robloxUser + '** is not currently on the server.' });
        }

        if (!player._vehicle) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(config.colors.neutral)
                .setTitle('🚗 Vehicle Info — ' + robloxUser)
                .setDescription('You are currently **on foot**. Get in a vehicle first!')
                .setFooter({ text: 'RCRP Vehicle Info' }).setTimestamp(),
            ],
          });
        }

        const color   = player._vehicleColor ? player._vehicleColor.split('(')[0].trim() : 'Unknown';
        const model   = player._vehicle;
        const plate   = player._vehiclePlate || 'N/A';
        const livery  = player._vehicleLivery || 'None';

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('🚗 Vehicle Info — ' + robloxUser)
          .addFields(
            { name: '🏎️ Model',   value: model,  inline: true },
            { name: '🎨 Color',   value: color,  inline: true },
            { name: '🔑 Plate',   value: plate,  inline: true },
            { name: '🖼️ Livery',  value: livery, inline: true },
          )
          .setFooter({ text: 'RCRP Live Vehicle Data' }).setTimestamp(new Date(snapshot._meta?.timestamp || Date.now()));

        return interaction.editReply({ embeds: [embed] });
      }

      // ── /community where ────────────────────────────────────
      if (sub === 'where') {
        const username = interaction.options.getString('username').trim();
        const snapshot = await getLatestSnapshot(guild);
        if (!snapshot) return interaction.editReply({ content: '⚠️ No snapshot data available.' });

        const player = (snapshot.players || []).find(p =>
          (p._username || '').toLowerCase() === username.toLowerCase()
        );

        if (!player) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(config.colors.neutral)
                .setTitle('📍 Player Location — ' + username)
                .setDescription('**' + username + '** is not on the server right now.')
                .setFooter({ text: 'RCRP Location System' }).setTimestamp(),
            ],
          });
        }

        const loc  = player._location;
        const locStr = loc
          ? 'Postal **' + (loc.PostalCode || '?') + '** — ' + (loc.StreetName || '?') + (loc.Zone ? ' (' + loc.Zone + ')' : '')
          : 'Location unknown';
        const veh  = player._vehicle
          ? (player._vehicleColor ? player._vehicleColor.split('(')[0].trim() + ' ' : '') + player._vehicle
          : 'On foot';

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('📍 Player Location — ' + username)
          .addFields(
            { name: '📍 Location', value: locStr,         inline: false },
            { name: '🚗 Vehicle',  value: veh,            inline: true  },
            { name: '🏷️ Team',    value: player._team || 'Civilian', inline: true },
            { name: '❤️ Health',  value: (player._health != null ? Math.round(player._health) + '%' : 'N/A'), inline: true },
          )
          .setFooter({ text: 'RCRP Location System' }).setTimestamp(new Date(snapshot._meta?.timestamp || Date.now()));

        return interaction.editReply({ embeds: [embed] });
      }

      // ── /community scenario ─────────────────────────────────
      if (sub === 'scenario') {
        const title   = interaction.options.getString('title');
        const desc    = interaction.options.getString('description');
        const roles   = interaction.options.getString('roles') || 'Any roles';

        const scenarioCh = guild.channels.cache.get(config.channels.scenarioBoard) || interaction.channel;

        const embed = new EmbedBuilder()
          .setColor(config.colors.primary)
          .setTitle('🎭 Scenario Suggestion — ' + title)
          .setDescription(desc)
          .addFields(
            { name: '🎯 Roles Involved', value: roles, inline: false },
            { name: '📝 Submitted By',   value: '<@' + interaction.user.id + '> — ' + interaction.member.displayName, inline: true },
            { name: '📅 Date',           value: '<t:' + Math.floor(Date.now()/1000) + ':F>', inline: true },
          )
          .setFooter({ text: 'RCRP Scenario Board  •  Upvote to get it played!' })
          .setTimestamp();

        const voteRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('scenario_upvote').setLabel('👍 Upvote').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('scenario_downvote').setLabel('👎 Downvote').setStyle(ButtonStyle.Danger),
        );

        const posted = await scenarioCh.send({ embeds: [embed], components: [voteRow] });
        await posted.react('🎭').catch(() => {});
        return interaction.editReply({ content: '✅ Scenario posted in <#' + scenarioCh.id + '>! Community can vote on it.' });
      }

      // ── /community vouch ────────────────────────────────────
      if (sub === 'vouch') {
        const target = interaction.options.getUser('member');
        const reason = interaction.options.getString('reason').trim();

        if (target.id === interaction.user.id) {
          return interaction.editReply({ content: '❌ You cannot vouch for yourself!' });
        }
        if (target.bot) {
          return interaction.editReply({ content: '❌ You cannot vouch for a bot.' });
        }

        // Cooldown: 1 vouch per user per 24h
        const lastVouch = vouchCooldowns.get(interaction.user.id);
        if (lastVouch && Date.now() - lastVouch < 24 * 60 * 60 * 1000) {
          const timeLeft = Math.ceil((24 * 60 * 60 * 1000 - (Date.now() - lastVouch)) / 3600000);
          return interaction.editReply({ content: '⏳ You can only vouch once every 24 hours. Try again in **' + timeLeft + 'h**.' });
        }

        const vouchCh = guild.channels.cache.get(config.channels.vouchBoard) || interaction.channel;

        const embed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle('✅ Community Vouch')
          .setDescription('<@' + interaction.user.id + '> has vouched for <@' + target.id + '>!')
          .addFields(
            { name: '🎯 Vouched For', value: '<@' + target.id + '> — ' + (guild.members.cache.get(target.id)?.displayName || target.username), inline: true },
            { name: '👤 Vouched By',  value: '<@' + interaction.user.id + '> — ' + interaction.member.displayName, inline: true },
            { name: '💬 Reason',      value: reason.slice(0, 500), inline: false },
            { name: '📅 Date',        value: '<t:' + Math.floor(Date.now()/1000) + ':F>', inline: true },
          )
          .setFooter({ text: 'RCRP Vouch System  •  Community Recognition' })
          .setTimestamp();

        await vouchCh.send({ embeds: [embed] });
        vouchCooldowns.set(interaction.user.id, Date.now());
        return interaction.editReply({ content: '✅ Vouch posted for **' + (guild.members.cache.get(target.id)?.displayName || target.username) + '** in <#' + vouchCh.id + '>!' });
      }
    },
  };
  