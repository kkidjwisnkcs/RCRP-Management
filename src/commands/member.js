// ============================================================
// member.js  —  /member [where|mycar|mystats|scenario|vouch|vouches]
// Verified members only. No staff gate needed.
// ============================================================
'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const config       = require('../config');
const erlc         = require('../utils/erlc');
const db           = require('../utils/discordDb');
const ai           = require('../utils/ai');
const perms        = require('../utils/permissions');
const sessionStore = require('../modules/sessionStore');

// In-memory vouch store (resets on restart — good enough)
const vouchGiven    = new Map();   // `${giverId}:${targetId}` → timestamp
const vouchReceived = new Map();   // discordId → [{from, note, ts}]

const SCENARIOS = [
  "You're a DOT worker who finds a jackknifed semi blocking both lanes on Route 7, Postal 45. No driver visible. Fuel is leaking.",
  "You're EMS first on scene at a two-car collision. One driver is unconscious, the other is refusing all medical aid.",
  "You're a LEO patrolling Postal 22 when dispatch reports a silent bank alarm. Building appears empty.",
  "A fully-loaded passenger bus has rolled onto its side at Postal 67. Multiple casualties expected.",
  "You're a firefighter called to a structure fire at downtown apartments. Reports of a person trapped on the 3rd floor.",
  "High-speed pursuit has ended: suspect's car crashed into a utility pole at Postal 88. Suspect fled on foot.",
  "DOT call — a sinkhole is forming mid-road on Route 3. Traffic backing up. One car partially fallen in.",
  "Mass RDM event in Zone B. Multiple reports of shots fired. Civilians sheltering in a nearby store.",
  "A fishing boat capsized at the river crossing near Postal 12. Two people in the water, one not moving.",
  "Reports of a large street race being organised at the industrial site near Zone C. 15+ vehicles involved.",
  "Gas station at Postal 55 being robbed by two armed suspects in ski masks. Panic button hit by attendant.",
  "An off-duty LEO in a personal vehicle reports being followed aggressively by an unknown black SUV.",
  "A prisoner transport vehicle has broken down on Route 7 with a dangerous inmate aboard.",
  "You're a dispatcher — six units unavailable. Armed robbery in progress at the bank. Who do you send?",
  "A cyclist was struck by a vehicle at Postal 30. Witness says the car fled northbound. Partial plate: A7.",
  "Tornado warning active. You're DOT and need to clear civilians from exposed roads immediately.",
  "A local business owner reports someone has been casing his store from the parking lot for 30+ minutes.",
  "A man collapsed in the park — bystanders say he just dropped with no warning. CPR in progress.",
  "Reports of a massive vehicle pile-up on the highway near Zone D. Multiple injuries, road blocked both ways.",
  "A tanker truck has overturned at Postal 78 and is leaking an unknown substance. Hazmat situation.",
  "You find an abandoned vehicle with the engine still running and a child locked inside.",
  "A helicopter has made an emergency landing on Route 3. Pilot is unresponsive. No visible fire yet.",
  "Three separate callers report a man with a weapon near the school at Postal 15. No confirmation yet.",
  "A boat is adrift on the river with no one visible aboard. Reported by a passing motorist.",
  "You respond to a welfare check at a house. Neighbours report no movement in three days.",
];

const SCENARIOS_EXPORT = SCENARIOS;
module.exports = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('Member tools — ERLC lookup, personal stats, RP tools, community rep.')

    .addSubcommand(s => s
      .setName('where')
      .setDescription('Find where a specific player currently is in River City.')
      .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('mycar')
      .setDescription('See your current in-game vehicle with an AI note about your style.')
    )
    .addSubcommand(s => s
      .setName('mystats')
      .setDescription('Your personal RCRP history — sessions, total time, vouches and more.')
    )
    .addSubcommand(s => s
      .setName('scenario')
      .setDescription('Get a random RP scenario to spice up your session.')
    )
    .addSubcommand(s => s
      .setName('vouch')
      .setDescription('Vouch for a community member for great RP. (24h cooldown per target)')
      .addUserOption(o => o.setName('member').setDescription('Member to vouch for').setRequired(true))
      .addStringOption(o => o.setName('note').setDescription('Why? e.g. "great pursuit scenario tonight"').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('vouches')
      .setDescription('See vouch count and recent vouches for a member.')
      .addUserOption(o => o.setName('member').setDescription('Member to check (defaults to yourself)').setRequired(false))
    ),

  async execute(interaction) {
    if (!perms.isVerified(interaction.member)) {
      return interaction.reply({
        content: '🔒 You must be **verified** to use member commands. Head to the verify channel first!',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // Scenario is public; rest are ephemeral
    await interaction.deferReply({ ephemeral: sub !== 'scenario' });

    // ── /member where ─────────────────────────────────────────────────────
    if (sub === 'where') {
      const username = interaction.options.getString('username');
      const snapshot = erlc.getCachedSnapshot();
      if (!snapshot) return interaction.editReply({ content: '❌ ERLC data not available right now. Try again shortly.' });

      const player = erlc.findPlayerByName(username);
      if (!player) return interaction.editReply({ content: `**${username}** is not in River City right now. (Data: ${erlc.getCacheAge()}s old)` });

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('📍  ' + player._username + ' — Current Location')
        .addFields(
          { name: '👥 Team',        value: player._team      || 'Unknown',   inline: true },
          { name: '🚗 Vehicle',     value: player._vehicle   || 'On foot',   inline: true },
          { name: '🏷️ Callsign',   value: player._callsign  || 'None',      inline: true },
          { name: '🎖️ Permission', value: player._permission || 'Civilian', inline: true },
          { name: '🆔 Roblox ID',  value: '`' + player._userId + '`',       inline: true },
          { name: '⏱️ Data Age',   value: erlc.getCacheAge() + 's old',      inline: true },
        )
        .setFooter({ text: 'RCRP — Live ERLC Data' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /member mycar ─────────────────────────────────────────────────────
    if (sub === 'mycar') {
      const snapshot = erlc.getCachedSnapshot();
      if (!snapshot) return interaction.editReply({ content: '❌ ERLC data not available right now.' });

      const verifyCh = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
      if (!verifyCh) return interaction.editReply({ content: 'Verify database not configured.' });
      const { users } = await db.getVerifyDb(verifyCh);
      const me = users.find(u => u.discordId === interaction.user.id && u.status === 'active');
      if (!me) return interaction.editReply({ content: 'You are not verified with a Roblox account.' });

      const player = erlc.findPlayerById(me.robloxId);
      if (!player) return interaction.editReply({ content: `**${me.robloxUsername}** is not currently in River City.` });
      if (!player._vehicle) return interaction.editReply({ content: `You're on foot right now, **${player._username}**. Hop in something.` });

      let aiLine = 'One smooth driver right there.';
      try {
        aiLine = await ai.ask('In one fun sentence (max 18 words), describe the vibe of a player in a roleplay server driving a "' + player._vehicle + '". No hashtags. Be playful.');
      } catch { /* ok */ }

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('🚗  ' + player._username + '\'s Current Ride')
        .setDescription('*"' + aiLine + '"*')
        .addFields(
          { name: '🚗 Vehicle',   value: player._vehicle,           inline: true },
          { name: '👥 Team',      value: player._team || 'Unknown', inline: true },
          { name: '🏷️ Callsign', value: player._callsign || 'None', inline: true },
        )
        .setFooter({ text: 'RCRP — Live ERLC Data' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /member mystats ───────────────────────────────────────────────────
    if (sub === 'mystats') {
      const verifyCh = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
      if (!verifyCh) return interaction.editReply({ content: 'Verify database not configured.' });
      const { users } = await db.getVerifyDb(verifyCh);
      const me = users.find(u => u.discordId === interaction.user.id && u.status === 'active');
      if (!me) return interaction.editReply({ content: 'You are not verified.' });

      const allSessions = await sessionStore.fetchAllSessions(interaction.guild);
      const myRecord    = allSessions.get(me.robloxId);
      const snapshot    = erlc.getCachedSnapshot();
      const player      = snapshot ? erlc.findPlayerById(me.robloxId) : null;

      const sessions  = myRecord?.sessions || [];
      const totalMin  = sessions.reduce((a, s) => a + s.durationMin, 0);
      const totalH    = Math.floor(totalMin / 60);
      const totalM    = totalMin % 60;
      const myVouches = vouchReceived.get(interaction.user.id) || [];

      const embed = new EmbedBuilder()
        .setColor(config.colors.gold)
        .setTitle('📊  ' + me.robloxUsername + ' — RCRP Stats')
        .setDescription(player
          ? '🟢 **Currently in River City** — ' + (player._team || 'Unknown') + ' team'
          : '⭕ Not currently in-game')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '🎮 Roblox',        value: '**' + me.robloxUsername + '**\n`' + me.robloxId + '`', inline: true },
          { name: '⏱️ Total Time',    value: totalH > 0 ? totalH + 'h ' + totalM + 'm' : totalM + 'm',             inline: true },
          { name: '📅 Sessions',      value: String(sessions.length),                                               inline: true },
          { name: '🚗 Vehicle Now',   value: player?._vehicle || 'N/A',                                             inline: true },
          { name: '🏆 Vouches',       value: String(myVouches.length),                                              inline: true },
          { name: '✅ Verified',      value: '<t:' + Math.floor(new Date(me.verifiedAt || Date.now()).getTime() / 1000) + ':D>', inline: true },
        )
        .setFooter({ text: 'RCRP Member Stats — Powered by live snapshots' })
        .setTimestamp();

      if (sessions.length > 0) {
        const recent = sessions.sort((a, b) => b.startTs - a.startTs).slice(0, 5);
        embed.addFields({
          name: '📋 Last 5 Sessions',
          value: recent.map(s => {
            const h = Math.floor(s.durationMin / 60);
            const m = s.durationMin % 60;
            return '**' + s.date + '** — ' + (h > 0 ? h + 'h ' : '') + m + 'm';
          }).join('\n'),
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /member scenario ──────────────────────────────────────────────────
    if (sub === 'scenario') {
      const idx = Math.floor(Math.random() * SCENARIOS.length);
      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle('🎲  Random RP Scenario')
        .setDescription('**' + SCENARIOS[idx] + '**')
        .setFooter({ text: 'Scenario ' + (idx + 1) + ' of ' + SCENARIOS.length + '  ·  RCRP RP Tools — click to reroll' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('member_scenario_reroll').setLabel('🎲  New Scenario').setStyle(ButtonStyle.Secondary)
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // ── /member vouch ─────────────────────────────────────────────────────
    if (sub === 'vouch') {
      const target = interaction.options.getMember('member');
      const note   = (interaction.options.getString('note') || 'Great RP!').slice(0, 200);

      if (!target) return interaction.editReply({ content: 'Member not found.' });
      if (target.id === interaction.user.id) return interaction.editReply({ content: 'You cannot vouch for yourself.' });
      if (target.user?.bot) return interaction.editReply({ content: 'Bots don\'t get vouches.' });

      const cooldownKey = interaction.user.id + ':' + target.id;
      const lastGiven   = vouchGiven.get(cooldownKey);
      if (lastGiven && Date.now() - lastGiven < 24 * 3600_000) {
        const hoursLeft = Math.ceil((24 * 3600_000 - (Date.now() - lastGiven)) / 3600_000);
        return interaction.editReply({ content: 'You already vouched for **' + target.displayName + '** recently. Cooldown: **' + hoursLeft + 'h** remaining.' });
      }

      vouchGiven.set(cooldownKey, Date.now());
      if (!vouchReceived.has(target.id)) vouchReceived.set(target.id, []);
      const list  = vouchReceived.get(target.id);
      list.push({ from: interaction.user.id, note, ts: Date.now() });
      const total = list.length;

      const embed = new EmbedBuilder()
        .setColor(config.colors.gold)
        .setTitle('🏆  Community Vouch')
        .setDescription('**' + interaction.member.displayName + '** vouched for **' + target.displayName + '**!\n\n*"' + note + '"*')
        .addFields(
          { name: '✅ Total Vouches', value: String(total), inline: true },
          { name: '👤 Recipient',    value: '<@' + target.id + '>', inline: true },
        )
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'RCRP Community Rep System' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Auto-shoutout milestones
      if ([10, 25, 50].includes(total)) {
        const milestone = total === 10 ? '⭐ Community Favourite' : total === 25 ? '🌟 Community Star' : '💎 Community Legend';
        const annCh = interaction.guild.channels.cache.get(config.channels.announcements);
        if (annCh) {
          await annCh.send({
            embeds: [new EmbedBuilder()
              .setColor(config.colors.gold)
              .setTitle('🏆  ' + milestone + ' — ' + target.displayName)
              .setDescription(
                '<@' + target.id + '> has reached **' + total + ' community vouches** in River City Role Play!\n\n' +
                'Latest from **' + interaction.member.displayName + '**: *"' + note + '"*\n\n' +
                'Proof that great RP gets noticed. 🎉'
              )
              .setThumbnail(target.displayAvatarURL({ dynamic: true }))
              .setFooter({ text: 'RCRP Community Rep' })
              .setTimestamp()]
          }).catch(() => {});
        }
      }
      return;
    }

    // ── /member vouches ───────────────────────────────────────────────────
    if (sub === 'vouches') {
      const target = interaction.options.getMember('member') || interaction.member;
      const list   = vouchReceived.get(target.id) || [];

      const embed = new EmbedBuilder()
        .setColor(list.length >= 10 ? config.colors.gold : config.colors.primary)
        .setTitle('🏆  Vouches — ' + target.displayName)
        .setDescription(list.length === 0
          ? '*No vouches yet. Play well and they will come.*'
          : '**' + list.length + ' vouch' + (list.length !== 1 ? 'es' : '') + '** received')
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'RCRP Community Rep System' })
        .setTimestamp();

      if (list.length) {
        embed.addFields({
          name: 'Most Recent Vouches',
          value: list.slice(-5).reverse()
            .map(v => '<@' + v.from + '>: *"' + v.note + '"*')
            .join('\n').slice(0, 1024),
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
module.exports.SCENARIOS_EXPORT = SCENARIOS;
