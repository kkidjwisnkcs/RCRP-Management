// /review — Staff Review System
  'use strict';
  const {
    SlashCommandBuilder, EmbedBuilder,
    PermissionFlagsBits,
  } = require('discord.js');
  const config = require('../config');
  const ai     = require('../utils/ai');

  const REVIEW_CHANNEL = '1487893136687759421';
  const STAR_LABELS    = { 1: 'Poor', 2: 'Below Average', 3: 'Average', 4: 'Good', 5: 'Outstanding' };

  function isPrivileged(member) {
    const staffRoles = config.staffRoles || [];
    if (staffRoles.some(r => member.roles.cache.has(r))) return true;
    return [
      PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers,
    ].some(p => member.permissions.has(p));
  }

  function getRoleLabel(member) {
    const r = config.roles;
    if (r.owner           && member.roles.cache.has(r.owner))           return 'Server Owner';
    if (r.coOwner         && member.roles.cache.has(r.coOwner))         return 'Co-Owner';
    if (r.serverDirector  && member.roles.cache.has(r.serverDirector))  return 'Server Director';
    if (r.deputyDirector  && member.roles.cache.has(r.deputyDirector))  return 'Deputy Director';
    if (r.hr              && member.roles.cache.has(r.hr))              return 'Human Resources';
    if (r.seniorManager   && member.roles.cache.has(r.seniorManager))   return 'Senior Manager';
    if (r.manager         && member.roles.cache.has(r.manager))         return 'Manager';
    if (r.headAdmin       && member.roles.cache.has(r.headAdmin))       return 'Head Admin';
    if (r.seniorAdmin     && member.roles.cache.has(r.seniorAdmin))     return 'Senior Admin';
    if (r.gameStaff       && member.roles.cache.has(r.gameStaff))       return 'Game Staff';
    if (r.trialStaff      && member.roles.cache.has(r.trialStaff))      return 'Trial Game Staff';
    if (r.headModerator   && member.roles.cache.has(r.headModerator))   return 'Head Moderator';
    if (r.seniorMod       && member.roles.cache.has(r.seniorMod))       return 'Senior Moderator';
    if (r.moderator       && member.roles.cache.has(r.moderator))       return 'Moderator';
    if (r.trialMod        && member.roles.cache.has(r.trialMod))        return 'Trial Moderator';
    if (r.discordMod      && member.roles.cache.has(r.discordMod))      return 'Discord Moderator';
    if (r.trialDiscordMod && member.roles.cache.has(r.trialDiscordMod)) return 'Trial Discord Mod';
    if (r.mediaTeam       && member.roles.cache.has(r.mediaTeam))       return 'Media Team';
    const top = [...member.roles.cache.values()]
      .filter(role => role.id !== member.guild.id)
      .sort((a, b) => b.position - a.position)[0];
    return top ? top.name : 'Staff Member';
  }

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('review')
      .setDescription('Staff review system — list staff, submit reviews, view history.')
      .addSubcommand(s => s
        .setName('list')
        .setDescription('List all staff members with elevated permissions.')
      )
      .addSubcommand(s => s
        .setName('submit')
        .setDescription('Submit a star rating review for a staff member.')
        .addUserOption(o => o.setName('staff').setDescription('Staff member to review').setRequired(true))
        .addIntegerOption(o => o.setName('stars').setDescription('Rating (1-5)').setRequired(true).setMinValue(1).setMaxValue(5))
        .addStringOption(o => o.setName('comment').setDescription('Your review').setRequired(true).setMinLength(10).setMaxLength(800))
      )
      .addSubcommand(s => s
        .setName('view')
        .setDescription('View review history for a staff member.')
        .addUserOption(o => o.setName('staff').setDescription('Staff member to view').setRequired(true))
      ),

    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'list')   return handleList(interaction);
      if (sub === 'submit') return handleSubmit(interaction);
      if (sub === 'view')   return handleView(interaction);
    },
  };

  async function handleList(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.guild.members.fetch().catch(() => {});
    const staff = interaction.guild.members.cache.filter(m => !m.user.bot && isPrivileged(m));
    if (!staff.size) return interaction.editReply({ content: 'No staff members found.' });

    const groups = {};
    staff.forEach(m => {
      const label = getRoleLabel(m);
      if (!groups[label]) groups[label] = [];
      groups[label].push(m);
    });

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('RCRP Staff Directory — ' + staff.size + ' members')
      .setDescription('All members with staff roles. Use `/review submit` to review any of them.')
      .setFooter({ text: 'RCRP Management — River City Role Play' })
      .setTimestamp();

    for (const [label, members] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
      embed.addFields({ name: label + ' (' + members.length + ')', value: members.map(m => '<@' + m.id + '>').join(', ').slice(0, 1024), inline: false });
      if ((embed.data.fields?.length || 0) >= 25) break;
    }
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const targetUser   = interaction.options.getUser('staff');
    const stars        = interaction.options.getInteger('stars');
    const comment      = interaction.options.getString('comment');
    const reviewer     = interaction.user;
    const guild        = interaction.guild;

    const targetMember = guild.members.cache.get(targetUser.id) ||
      await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) return interaction.editReply({ content: 'Could not find that member.' });
    if (!isPrivileged(targetMember)) return interaction.editReply({ content: 'That member is not a staff member.' });
    if (reviewer.id === targetUser.id) return interaction.editReply({ content: 'You cannot review yourself.' });

    const roleLabel = getRoleLabel(targetMember);
    const starStr   = '⭐'.repeat(stars);
    const starLabel = STAR_LABELS[stars] || 'Rated';

    let aiMsg = '';
    try {
      aiMsg = await ai.chat(
        'You are the RCRP Management bot. Write short warm appreciation messages for staff members receiving reviews. Keep it genuine and punchy.',
        'Staff member "' + targetMember.displayName + '" (' + roleLabel + ') got ' + stars + '/5 stars: "' + comment.slice(0, 150) + '". Write a short warm shoutout.',
        100
      ) || '';
    } catch {}

    const color  = stars >= 4 ? config.colors.success : stars >= 3 ? config.colors.warning : config.colors.danger;
    const embed  = new EmbedBuilder()
      .setColor(color)
      .setTitle('Staff Review — ' + targetMember.displayName)
      .setThumbnail(targetMember.displayAvatarURL())
      .setDescription(starStr + ' ' + starLabel + ' — ' + stars + '/5\n\n"' + comment + '"' + (aiMsg ? '\n\n*' + aiMsg + '*' : ''))
      .addFields(
        { name: 'Staff Member', value: '<@' + targetMember.id + '>', inline: true },
        { name: 'Role',         value: roleLabel,                    inline: true },
        { name: 'Reviewed By',  value: '<@' + reviewer.id + '>',    inline: true },
      )
      .setFooter({ text: 'RCRP Management — Staff Review System' })
      .setTimestamp();

    const reviewCh = guild.channels.cache.get(REVIEW_CHANNEL);
    if (reviewCh) await reviewCh.send({ embeds: [embed] }).catch(() => {});

    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle('You received a staff review!')
        .setDescription(starStr + ' ' + starLabel + ' — ' + stars + '/5\n\n"' + comment + '"' + (aiMsg ? '\n\n*' + aiMsg + '*' : ''))
        .addFields({ name: 'Reviewed By', value: reviewer.username })
        .setFooter({ text: 'RCRP Management' }).setTimestamp();
      await targetMember.send({ embeds: [dmEmbed] });
    } catch {}

    await interaction.editReply({ content: 'Review for **' + targetMember.displayName + '** (' + starStr + ') posted in <#' + REVIEW_CHANNEL + '>.' });
  }

  async function handleView(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('staff');
    const guild      = interaction.guild;
    try {
      const reviewCh = guild.channels.cache.get(REVIEW_CHANNEL);
      if (!reviewCh) return interaction.editReply({ content: 'Review channel not found.' });

      const msgs    = await reviewCh.messages.fetch({ limit: 100 });
      const reviews = [...msgs.values()].filter(m =>
        m.author.bot &&
        m.embeds?.[0]?.title?.includes('Staff Review') &&
        m.embeds[0]?.fields?.some(f => f.value.includes(targetUser.id))
      );

      if (!reviews.length) return interaction.editReply({ content: 'No reviews found for <@' + targetUser.id + '>.' });

      let totalStars = 0;
      let count = 0;
      for (const msg of reviews) {
        const match = (msg.embeds[0]?.description || '').match(/(\d)\/5/);
        if (match) { totalStars += parseInt(match[1]); count++; }
      }
      const avg      = count ? (totalStars / count).toFixed(1) : 'N/A';
      const avgStars = count ? '⭐'.repeat(Math.round(totalStars / count)) : '';

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('Review History — ' + targetUser.username)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(count + ' review' + (count !== 1 ? 's' : '') + ' — Average: **' + avg + '/5** ' + avgStars)
        .addFields({ name: 'Full History', value: 'See <#' + REVIEW_CHANNEL + '> for all posted reviews.' })
        .setFooter({ text: 'RCRP Management — Staff Review System' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Review] view error:', err.message);
      await interaction.editReply({ content: 'Could not fetch review history.' });
    }
  }
  