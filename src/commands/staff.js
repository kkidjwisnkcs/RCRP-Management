// staff.js — Staff Commands
  // /countdown /callout /staffsessions /dutysignup /calendar /log /search
  'use strict';

  const {
    SlashCommandBuilder, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
  } = require('discord.js');
  const config      = require('../config');
  const erlc        = require('../utils/erlc');
  const perms       = require('../utils/permissions');
  const db          = require('../utils/discordDb');
  const dutySignup  = require('../modules/dutySignup');
  const staffCal    = require('../modules/staffCalendar');

  // ── Live Countdown Store ───────────────────────────────────
  const countdowns = new Map();

  async function refreshCountdowns(client) {
    for (const [msgId, cd] of countdowns.entries()) {
      const remaining = cd.endsAt - Date.now();
      const ch = client?.channels.cache.get(cd.channelId);
      if (!ch) continue;
      const msg = await ch.messages.fetch(msgId).catch(() => null);
      if (!msg) { countdowns.delete(msgId); continue; }
      if (remaining <= 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle('🟢 SESSION IS LIVE — ' + cd.label)
          .setDescription('River City is **OPEN**. Get in game!')
          .setFooter({ text: 'RCRP Session System' }).setTimestamp();
        await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
        // Fire session ping
        const annCh = client.channels.cache.get(config.channels.sessionAnnouncements);
        if (annCh) await annCh.send({ content: '<@&' + config.roles.sessionPing + '> — Session is now LIVE! Join River City now.', embeds: [embed] }).catch(() => {});
        countdowns.delete(msgId);
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        await msg.edit({ embeds: [buildCountdownEmbed(cd.label, mins, secs, cd.endsAt)] }).catch(() => {});
      }
    }
  }

  function buildCountdownEmbed(label, mins, secs, endsAt) {
    return new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('⏳ SESSION COUNTDOWN — ' + label)
      .setDescription('**' + String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0') + '** until River City opens!')
      .addFields({ name: '⏰ Opens At', value: '<t:' + Math.floor(endsAt/1000) + ':T>', inline: true })
      .setFooter({ text: 'RCRP Session System — Stay tuned!' }).setTimestamp();
  }

  function parseDuration(str) {
    const m = str.match(/^(\d+)(m|min|s|sec|h|hr)?$/i);
    if (!m) return null;
    const n    = parseInt(m[1], 10);
    const unit = (m[2] || 'm').toLowerCase();
    if (unit.startsWith('s')) return n * 1000;
    if (unit.startsWith('h')) return n * 3600000;
    return n * 60000;
  }

  // ── Staff Log storage helpers ──────────────────────────────
  const ACTION_COLORS = {
    warn:   0xC37D00,
    kick:   0xED4245,
    ban:    0x992D22,
    strike: 0xFF6B00,
    note:   0x3498DB,
    mute:   0x9B59B6,
  };
  const ACTION_EMOJIS = {
    warn:   '⚠️',
    kick:   '🦵',
    ban:    '🔨',
    strike: '💥',
    note:   '📝',
    mute:   '🔇',
  };

  async function fetchPlayerLogs(guild, username) {
    try {
      const ch = guild.channels.cache.get(config.channels.discordDatabase);
      if (!ch) return [];
      const msgs = await ch.messages.fetch({ limit: 200 });
      return [...msgs.values()].filter(m =>
        m.author.bot &&
        m.embeds?.[0]?.title?.startsWith('[STAFF LOG]') &&
        m.embeds[0]?.fields?.some(f =>
          f.name === 'Target' && f.value.toLowerCase().includes(username.toLowerCase())
        )
      );
    } catch { return []; }
  }

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('staff')
      .setDescription('Staff management tools.')
      .addSubcommand(sub => sub
        .setName('countdown')
        .setDescription('Post a live-updating session countdown. Fires a ping when it hits zero.')
        .addStringOption(o => o.setName('duration').setDescription('e.g. 30m, 1h, 45m').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Session label e.g. Session #14').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('callout')
        .setDescription('Post a formatted MDT callout embed to the MDT channel.')
        .addStringOption(o => o.setName('code').setDescription('10-code or callout type e.g. 10-80').setRequired(true))
        .addStringOption(o => o.setName('location').setDescription('Location / postal e.g. Route 7 Postal 45').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Details e.g. Black Charger heading north').setRequired(true))
        .addStringOption(o => o.setName('units').setDescription('Units requested e.g. 2 LEO, 1 EMS').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('dutysignup')
        .setDescription('Post a duty sign-up embed for an upcoming session.')
        .addStringOption(o => o.setName('title').setDescription('Session name e.g. Friday Night Session').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Session time e.g. 8PM EST').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('staffsessions')
        .setDescription('View full breakdown of every staff member session history by date.')
        .addUserOption(o => o.setName('member').setDescription('Specific staff member (optional)').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('calendar')
        .setDescription('Post the live weekly staff calendar to staff chat.')
      )
      .addSubcommand(sub => sub
        .setName('log')
        .setDescription('Log a staff action (warn/kick/ban/strike/note/mute) against any player.')
        .addStringOption(o => o
          .setName('action')
          .setDescription('Action type')
          .setRequired(true)
          .addChoices(
            { name: 'Warn',   value: 'warn'   },
            { name: 'Kick',   value: 'kick'   },
            { name: 'Ban',    value: 'ban'    },
            { name: 'Strike', value: 'strike' },
            { name: 'Note',   value: 'note'   },
            { name: 'Mute',   value: 'mute'   },
          )
        )
        .addStringOption(o => o.setName('username').setDescription('Roblox username of the player').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for this action').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Duration if applicable e.g. 24h, Permanent').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('search')
        .setDescription('Search the full action history for any player.')
        .addStringOption(o => o.setName('username').setDescription('Roblox username to search').setRequired(true))
      ),

    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (!perms.isStaff(interaction.member) && !perms.isManagement(interaction.member)) {
        return perms.denyPermission(interaction, 'Staff');
      }

      await interaction.deferReply();

      // ── /staff countdown ──────────────────────────────────
      if (sub === 'countdown') {
        const raw      = interaction.options.getString('duration');
        const label    = interaction.options.getString('label') || 'Upcoming Session';
        const duration = parseDuration(raw);
        if (!duration) return interaction.editReply({ content: 'Invalid duration. Use e.g. 30m, 1h, 45m.' });

        const endsAt   = Date.now() + duration;
        const mins     = Math.floor(duration / 60000);
        const secs     = Math.floor((duration % 60000) / 1000);
        const annCh    = interaction.guild.channels.cache.get(config.channels.sessionAnnouncements) || interaction.channel;
        const embed    = buildCountdownEmbed(label, mins, secs, endsAt);
        const msg      = await annCh.send({ embeds: [embed] });
        countdowns.set(msg.id, { endsAt, channelId: annCh.id, label });

        if (!interaction.client._countdownInterval) {
          interaction.client._countdownInterval = setInterval(() => refreshCountdowns(interaction.client), 30_000);
        }
        return interaction.editReply({ content: 'Countdown posted in <#' + annCh.id + '>! Will auto-ping when it hits zero.' });
      }

      // ── /staff callout ────────────────────────────────────
      if (sub === 'callout') {
        const code  = interaction.options.getString('code');
        const loc   = interaction.options.getString('location');
        const desc  = interaction.options.getString('description');
        const units = interaction.options.getString('units') || 'All available units';
        const mdtCh = interaction.guild.channels.cache.get(config.channels.mdt);
        if (!mdtCh) return interaction.editReply({ content: 'MDT channel not configured.' });

        const embed = new EmbedBuilder()
          .setColor(config.colors.danger)
          .setTitle('📢 CALLOUT — ' + code.toUpperCase())
          .setDescription(interaction.member.displayName + ' has issued a callout via MDT.')
          .addFields(
            { name: '📡 Code',         value: code.toUpperCase(), inline: true },
            { name: '📍 Location',     value: loc,               inline: true },
            { name: '📋 Description',  value: desc,              inline: false },
            { name: '🚔 Units Needed', value: units,             inline: true },
            { name: '🕐 Time',         value: '<t:' + Math.floor(Date.now()/1000) + ':T>', inline: true },
            { name: '👮 Issued By',    value: interaction.member.displayName, inline: true },
          )
          .setFooter({ text: 'RCRP MDT — Structured Callout System' }).setTimestamp();

        await mdtCh.send({ content: '@here — Callout incoming!', embeds: [embed] });
        return interaction.editReply({ content: 'Callout posted to <#' + mdtCh.id + '>!' });
      }

      // ── /staff dutysignup ─────────────────────────────────
      if (sub === 'dutysignup') {
        const title   = interaction.options.getString('title');
        const time    = interaction.options.getString('time');
        const staffCh = interaction.guild.channels.cache.get(config.channels.staffChat) || interaction.channel;
        const sid     = await dutySignup.postSignupEmbed(staffCh, title, time);
        return interaction.editReply({ content: 'Duty sign-up posted in <#' + staffCh.id + '>! Session ID: ' + sid });
      }

      // ── /staff staffsessions ──────────────────────────────
      if (sub === 'staffsessions') {
        const targetUser   = interaction.options.getUser('member');
        const sessionStore = require('../modules/sessionStore');

        await interaction.editReply({ content: '🔍 Loading session records from database...' });

        const allSessions = await sessionStore.fetchAllSessions(interaction.guild);

        if (!allSessions.size) {
          return interaction.editReply({ content: 'No session records yet. Sessions are saved when staff leave the game.' });
        }

        const pages = [];

        for (const [robloxId, data] of allSessions.entries()) {
          if (targetUser && data.discordId !== targetUser.id) continue;
          const dcMember = interaction.guild.members.cache.get(data.discordId);
          if (!dcMember) continue;
          if (!perms.isStaff(dcMember) && !perms.isManagement(dcMember)) continue;

          // Group by date
          const byDate = new Map();
          for (const s of data.sessions.sort((a, b) => a.startTs - b.startTs)) {
            if (!byDate.has(s.date)) byDate.set(s.date, []);
            byDate.get(s.date).push(s);
          }

          const totalMin = data.sessions.reduce((a, s) => a + s.durationMin, 0);
          const totalH   = Math.floor(totalMin / 60);
          const totalM   = totalMin % 60;

          const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle('📋 Sessions — ' + dcMember.displayName + '  (' + data.robloxUsername + ')')
            .setDescription(
              '**Total:** ' + (totalH > 0 ? totalH + 'h ' : '') + totalM + 'm  across **' +
              data.sessions.length + ' session' + (data.sessions.length !== 1 ? 's' : '') + '**'
            )
            .setThumbnail(dcMember.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: 'RCRP Staff Sessions  ·  Persistent DB  ·  Newest first' })
            .setTimestamp();

          const dateEntries = [...byDate.entries()]
            .sort((a, b) => new Date(b[0]) - new Date(a[0]))
            .slice(0, 15);

          for (const [dateStr, sessions] of dateEntries) {
            const sessMin = sessions.reduce((a, s) => a + s.durationMin, 0);
            const h = Math.floor(sessMin / 60);
            const m = sessMin % 60;
            const dateDisp = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', {
              weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
            });
            embed.addFields({
              name:  '📅 ' + dateDisp,
              value: '⏱️ **' + (h > 0 ? h + 'h ' : '') + m + 'm**  ·  ' + sessions.length + ' session' + (sessions.length !== 1 ? 's' : ''),
              inline: false,
            });
          }

          // Live indicator
          const activeShifts = sessionStore.getActiveShifts();
          const liveEntry    = [...activeShifts.entries()].find(([, s]) => s.discordId === data.discordId);
          if (liveEntry) {
            const curMin = Math.floor((Date.now() - liveEntry[1].startTime) / 60000);
            embed.setDescription(embed.data.description + '\n🟢 **Currently in-game** — ' + curMin + 'm into active session');
          }

          pages.push(embed);
        }

        if (!pages.length) {
          return interaction.editReply({ content: targetUser ? 'No sessions for **' + targetUser.username + '** yet.' : 'No staff sessions found.' });
        }
        if (pages.length === 1) return interaction.editReply({ content: '', embeds: [pages[0]] });

        let page = 0;
        const buildRow = (p, t) => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ss_prev').setLabel('◀  Previous').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
          new ButtonBuilder().setCustomId('ss_page').setLabel((p+1) + ' / ' + t).setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('ss_next').setLabel('Next  ▶').setStyle(ButtonStyle.Secondary).setDisabled(p === t - 1),
        );
        const navMsg = await interaction.editReply({ content: '', embeds: [pages[0]], components: [buildRow(0, pages.length)] });
        const col = navMsg.createMessageComponentCollector({ time: 5 * 60_000 });
        col.on('collect', async btn => {
          if (btn.user.id !== interaction.user.id) return btn.reply({ content: 'Only the command user can navigate.', ephemeral: true });
          if (btn.customId === 'ss_prev' && page > 0) page--;
          if (btn.customId === 'ss_next' && page < pages.length - 1) page++;
          await btn.update({ embeds: [pages[page]], components: [buildRow(page, pages.length)] });
        });
        col.on('end', () => navMsg.edit({ components: [] }).catch(() => {}));
        return;
      }

      // ── /staff calendar ───────────────────────────────────
      if (sub === 'calendar') {
        const loaModule = require('./loa');
        await staffCal.refreshCalendar(
          loaModule?.loaStore,
          null,
          require('../modules/heartbeat').getActiveShifts?.() || new Map(),
          interaction.guild,
        );
        return interaction.editReply({ content: 'Staff calendar refreshed in staff chat.' });
      }

      // ── /staff log ────────────────────────────────────────
      if (sub === 'log') {
        const action   = interaction.options.getString('action');
        const username = interaction.options.getString('username').trim();
        const reason   = interaction.options.getString('reason').trim();
        const duration = interaction.options.getString('duration') || null;
        const staffMember = interaction.member;
        const guild    = interaction.guild;

        // Fetch existing logs for this player to show previous action count
        const prevLogs = await fetchPlayerLogs(guild, username);
        const prevCount = prevLogs.length;

        // Count previous warns/strikes specifically
        const prevWarns = prevLogs.filter(m => {
          const t = m.embeds?.[0]?.title || '';
          return t.includes('warn') || t.includes('strike');
        }).length;

        const emoji  = ACTION_EMOJIS[action] || '📋';
        const color  = ACTION_COLORS[action] || config.colors.neutral;
        const ts     = Math.floor(Date.now() / 1000);

        // Build the main log embed
        const logEmbed = new EmbedBuilder()
          .setColor(color)
          .setTitle('[STAFF LOG] ' + emoji + ' ' + action.toUpperCase() + ' — ' + username)
          .setDescription(
            '**' + emoji + ' ' + action.charAt(0).toUpperCase() + action.slice(1) + '** issued against **' + username + '**' +
            (prevCount > 0
              ? '\n\n> ⚠️ This player has **' + prevCount + ' previous action' + (prevCount !== 1 ? 's' : '') + '** on record' +
                (prevWarns > 0 ? ' (' + prevWarns + ' warn/strike).' : '.')
              : '\n\n> ✅ No previous actions on record for this player.')
          )
          .addFields(
            { name: '🎯 Target',      value: username,          inline: true  },
            { name: '⚡ Action',      value: emoji + ' ' + action.toUpperCase(), inline: true },
            { name: '📋 Reason',      value: reason,            inline: false },
            { name: '👮 Issued By',   value: '<@' + staffMember.id + '> — ' + staffMember.displayName, inline: true },
            { name: '📅 Date',        value: '<t:' + ts + ':F>', inline: true },
            ...(duration ? [{ name: '⏱️ Duration', value: duration, inline: true }] : []),
            { name: '📊 Total Actions', value: 'This is **action #' + (prevCount + 1) + '** for this player.', inline: false },
          )
          .setFooter({ text: 'RCRP Staff Log System  •  Action ID: ' + Date.now() })
          .setTimestamp();

        // Post to the channel where the command was run (visible to everyone in that channel)
        await interaction.editReply({ embeds: [logEmbed] });

        // Also store in discordDatabase for future searches
        const dbCh = guild.channels.cache.get(config.channels.discordDatabase);
        if (dbCh) await dbCh.send({ embeds: [logEmbed] }).catch(() => {});

        // Also post to staff chat if it's different
        const staffChatCh = guild.channels.cache.get(config.channels.staffChat);
        if (staffChatCh && staffChatCh.id !== interaction.channelId) {
          await staffChatCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
        return;
      }

      // ── /staff search ─────────────────────────────────────
      if (sub === 'search') {
        const username = interaction.options.getString('username').trim();
        const guild    = interaction.guild;

        await interaction.editReply({ content: 'Searching action history for **' + username + '**...' });

        const logs = await fetchPlayerLogs(guild, username);

        if (!logs.length) {
          return interaction.editReply({
            content: '',
            embeds: [
              new EmbedBuilder()
                .setColor(config.colors.success)
                .setTitle('🔍 Player Search — ' + username)
                .setDescription('✅ **No actions found.** This player has a clean record.')
                .setFooter({ text: 'RCRP Staff Log System' })
                .setTimestamp(),
            ],
          });
        }

        // Tally action types
        const tally = {};
        const history = [];
        for (const msg of logs.sort((a, b) => a.createdTimestamp - b.createdTimestamp)) {
          const embed   = msg.embeds[0];
          if (!embed) continue;
          const title   = embed.title || '';
          const actionMatch = title.match(/\] .* ([A-Z]+) —/);
          const act     = actionMatch ? actionMatch[1].toLowerCase() : 'unknown';
          tally[act]    = (tally[act] || 0) + 1;

          const reasonField = embed.fields?.find(f => f.name.includes('Reason'));
          const byField     = embed.fields?.find(f => f.name.includes('Issued By'));
          const dateField   = embed.fields?.find(f => f.name.includes('Date'));
          history.push({
            action: act,
            reason: reasonField?.value || 'Unknown',
            by:     byField?.value?.replace(/<@[^>]+>\s*—\s*/, '') || 'Unknown',
            date:   dateField?.value || '<t:' + Math.floor(msg.createdTimestamp/1000) + ':d>',
            msgUrl: msg.url,
          });
        }

        const tallyStr = Object.entries(tally)
          .map(([a, n]) => (ACTION_EMOJIS[a] || '📋') + ' **' + n + '** ' + a)
          .join('  •  ') || 'None';

        const total = logs.length;
        const risk  = total >= 5 ? '🔴 HIGH RISK' : total >= 3 ? '🟠 ELEVATED' : total >= 1 ? '🟡 FLAGGED' : '🟢 CLEAN';

        // Build paginated history — 5 entries per page
        const ITEMS_PER_PAGE = 5;
        const pageCount      = Math.ceil(history.length / ITEMS_PER_PAGE);
        let   page           = 0;

        function buildPage(p) {
          const slice = history.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
          const embed = new EmbedBuilder()
            .setColor(total >= 5 ? config.colors.danger : total >= 3 ? config.colors.warning : config.colors.neutral)
            .setTitle('🔍 Player Search — ' + username)
            .setDescription(
              '**Risk Level:** ' + risk + '\n' +
              '**Total Actions:** ' + total + '\n' +
              '**Breakdown:** ' + tallyStr
            )
            .setFooter({ text: 'RCRP Staff Log System  •  Page ' + (p+1) + ' of ' + pageCount })
            .setTimestamp();

          for (const entry of slice) {
            embed.addFields({
              name: (ACTION_EMOJIS[entry.action] || '📋') + ' ' + (entry.action || 'Action').toUpperCase() + ' — ' + entry.date,
              value: '**Reason:** ' + entry.reason.slice(0, 200) + '\n**By:** ' + entry.by.slice(0, 100),
              inline: false,
            });
          }
          return embed;
        }

        if (pageCount === 1) return interaction.editReply({ content: '', embeds: [buildPage(0)] });

        const buildNavRow = (p, total) => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('srch_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
          new ButtonBuilder().setCustomId('srch_page').setLabel((p+1) + ' / ' + total).setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('srch_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p === total - 1),
        );

        const navMsg = await interaction.editReply({ content: '', embeds: [buildPage(page)], components: [buildNavRow(page, pageCount)] });
        const col    = navMsg.createMessageComponentCollector({ time: 5 * 60_000 });
        col.on('collect', async btn => {
          if (btn.user.id !== interaction.user.id) return btn.reply({ content: 'Only the command runner can navigate.', ephemeral: true });
          if (btn.customId === 'srch_prev' && page > 0) page--;
          if (btn.customId === 'srch_next' && page < pageCount - 1) page++;
          await btn.update({ embeds: [buildPage(page)], components: [buildNavRow(page, pageCount)] });
        });
        col.on('end', () => navMsg.edit({ components: [] }).catch(() => {}));
        return;
      }
    },
  };
  