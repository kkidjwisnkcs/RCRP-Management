// applications.js — RCRP Application System
// Private channels, one-at-a-time Q&A, HR decisions, DMs, auto-role.
// Result embeds match the Las Vegas Roleplay style from the reference screenshot.

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const db     = require('../utils/discordDb');
const ai     = require('../utils/ai');

// channelId → { discordId, category, answers, step, startedAt, channelId }
const activeApps = new Map();

// ── Panel ─────────────────────────────────────────────────
async function postApplicationPanel(channel) {
  try {
    const msgs = await channel.messages.fetch({ limit: 20 });
    if ([...msgs.values()].some(m =>
      m.author.id === channel.client.user.id &&
      m.components?.some(r => r.components?.some(c => c.customId === 'apply_button'))
    )) return;
  } catch {}

  const catList = config.applicationCategories.map(c => `${c.emoji} **${c.label}** — ${c.description}`).join('\n');

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({ name: 'River City Role Play', iconURL: channel.guild.iconURL() || undefined })
    .setTitle('RCRP — Staff Applications')
    .setDescription(
      'Think you have what it takes to be part of **River City Role Play**?\n\n' +
      '**Available Positions:**\n' + catList + '\n\n' +
      '**Requirements:** Verified Roblox account · No active strikes · Professional conduct\n\n' +
      '**Process:**\n' +
      '> 1. Click **Apply Now** and select a department\n' +
      '> 2. A private channel is created just for you\n' +
      '> 3. Answer 15 questions honestly — one at a time\n' +
      '> 4. HR reviews within 24–48 hours\n' +
      '> 5. Decision posted in your channel + DM'
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  await channel.send({
    embeds:     [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('apply_button').setLabel('Apply Now').setStyle(ButtonStyle.Secondary)
    )],
  });
}

// ── Apply button ───────────────────────────────────────────
async function handleApplyButton(interaction) {
  const member       = interaction.member;
  const verifiedRole = config.roles.verified;
  if (verifiedRole && !member.roles.cache.has(verifiedRole) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'You must be verified before applying. Head to the verify channel first.', ephemeral: true });
  }

  const buttons = config.applicationCategories.map(c =>
    new ButtonBuilder().setCustomId(`app_category:${c.id}`).setLabel(c.label).setStyle(ButtonStyle.Secondary).setEmoji(c.emoji)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

  await interaction.reply({
    embeds:     [new EmbedBuilder().setColor(config.colors.primary).setTitle('Select Department').setDescription('Which department are you applying for?').setFooter({ text: 'RCRP Management — River City Role Play' })],
    components: rows,
    ephemeral:  true,
  });
}

// ── Category select ────────────────────────────────────────
async function handleCategorySelect(interaction) {
  await interaction.deferUpdate();
  const categoryId = interaction.customId.split(':')[1];
  const category   = config.applicationCategories.find(c => c.id === categoryId);
  const member     = interaction.member;
  const guild      = interaction.guild;
  if (!category) return;

  const questions = config.applicationQuestions[categoryId];
  if (!questions?.length) return;

  const existing = [...activeApps.values()].find(a => a.discordId === member.id);
  if (existing) {
    const ch = guild.channels.cache.get(existing.channelId);
    if (ch) return interaction.followUp({ content: `You already have an open application: ${ch}`, ephemeral: true });
  }

  let appCh;
  try {
    const safeName = `app-${categoryId}-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 45);
    const everyoneRole = guild.roles.everyone;
    const hrRoleId     = config.roles.hr;
    const botId        = guild.client.user.id;

    const overwrites = [
      { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id,       allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: botId,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ];
    if (hrRoleId) overwrites.push({ id: hrRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    // Try to put it in same category as staff-applications channel
    const parentCh = guild.channels.cache.get(config.channels.staffApplications);
    const parentId  = parentCh?.parentId || null;

    appCh = await guild.channels.create({
      name:                 safeName,
      type:                 ChannelType.GuildText,
      parent:               parentId,
      permissionOverwrites: overwrites,
      reason:               `Staff application for ${member.user.username}`,
    });
  } catch (err) {
    console.error('[Applications] Create channel:', err.message);
    return interaction.followUp({ content: 'Failed to create your application channel. Please contact an admin.', ephemeral: true });
  }

  const appData = { discordId: member.id, category: categoryId, channelId: appCh.id, answers: {}, step: 0, startedAt: new Date().toISOString() };
  activeApps.set(appCh.id, appData);

  const intro = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({ name: 'River City Role Play', iconURL: guild.iconURL() || undefined })
    .setTitle(`${category.emoji} ${category.label} Application`)
    .setDescription(
      `Welcome, ${member}.\n\nThis is your **private application channel**.\n\n` +
      `You will be asked **${questions.length} questions** one at a time. Send your answer as a message after each one.\n\n` +
      `Be honest — HR reviews every answer. Your first question is below.`
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  await appCh.send({ embeds: [intro] });
  setTimeout(() => askQuestion(appCh, questions, 0), 1200);

  try {
    await member.send({ embeds: [new EmbedBuilder()
      .setColor(0x1D6FA5)
      .setAuthor({ name: '📋  RCRP APPLICATIONS  —  River City Role Play' })
      .setTitle(`${category.emoji}  Application Started — ${category.label}`)
      .setDescription(
        `Welcome to the **${category.label}** application process!

` +
        `> Head to ${appCh} to get started.
` +
        `> Answer each question honestly and in full sentences.
` +
        `> Take your time — there is no rush.

` +
        `**Good luck! We are excited to review your application.**`
      )
      .setFooter({ text: 'RCRP Applications — River City Role Play' })
      .setTimestamp()
      .setFooter({ text: 'RCRP Management — River City Role Play' })
      .setTimestamp()
    ]});
  } catch {}

  await interaction.followUp({ content: `Your application channel is ready: ${appCh}`, ephemeral: true });
}

// ── Q&A engine ────────────────────────────────────────────
function askQuestion(channel, questions, qIndex) {
  const q = questions[qIndex];
  if (!q) return;
  channel.send({ embeds: [
    new EmbedBuilder()
      .setColor(config.colors.neutral)
      .setTitle(`Question ${qIndex + 1} of ${questions.length}`)
      .setDescription(q.label)
      .setFooter({ text: 'Reply with your answer — one message — RCRP Management' })
  ]}).catch(() => {});
}

async function handleApplicationMessage(message, client) {
  if (message.author.bot || !message.guild) return;
  const appData = activeApps.get(message.channelId);
  if (!appData)  return;

  const questions = config.applicationQuestions[appData.category];
  if (!questions)  return;

  const qIndex = appData.step;
  const q      = questions[qIndex];
  if (!q) return;

  appData.answers[q.id] = message.content;
  appData.step++;

  if (appData.step < questions.length) {
    setTimeout(() => {
      const ch = client.channels.cache.get(message.channelId);
      if (ch) askQuestion(ch, questions, appData.step);
    }, 1200);
  } else {
    await finalizeApplication(message.channel, appData, client);
  }
}

// ── Finalize ───────────────────────────────────────────────
async function finalizeApplication(channel, appData, client) {
  const category  = config.applicationCategories.find(c => c.id === appData.category);
  const questions = config.applicationQuestions[appData.category];
  const guild     = channel.guild;
  const member    = guild.members.cache.get(appData.discordId);

  await channel.send({ embeds: [new EmbedBuilder()
    .setColor(0x2D7D46)
    .setAuthor({ name: '✅  APPLICATION SUBMITTED  —  RCRP' })
    .setTitle(`${category?.emoji || '📋'}  ${category?.label} Application — Submitted`)
    .setDescription(
      `> Your application has been received and is now under review.

` +
      `**What happens next:**
` +
      `> 1. HR will review your answers within **24–48 hours**
` +
      `> 2. You will be notified here **and** via DM
` +
      `> 3. Please be patient — do not DM HR staff directly

` +
      `Thank you for applying to **River City Role Play**. We appreciate your interest!`
    )
    .setFooter({ text: 'RCRP Applications — River City Role Play' })
    .setTimestamp()
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp()
  ]});

  if (member) {
    try {
      await member.send({ embeds: [new EmbedBuilder()
        .setColor(0x2D7D46)
        .setAuthor({ name: '📬  APPLICATION SUBMITTED  —  RCRP' })
        .setTitle(`Your ${category?.label} Application is In!`)
        .setDescription(
          `**Congratulations on completing your application!** 🎉

` +
          `> HR will review within **24–48 hours**
` +
          `> Watch this DM and your application channel for updates
` +
          `> Do **not** DM HR staff — they will reach out to you

` +
          `We appreciate your interest in River City Role Play. Fingers crossed! 🤞`
        )
        .setFooter({ text: 'RCRP Applications — River City Role Play' })
        .setTimestamp()
        .setFooter({ text: 'RCRP Management — River City Role Play' })
        .setTimestamp()
      ]});
    } catch {}
  }

  // AI analysis
  let aiAnalysis = 'AI analysis unavailable.';
  try { aiAnalysis = await ai.analyzeApplication(appData.category, appData.answers, questions); } catch {}

  const hrCh = guild.channels.cache.get(config.channels.hrCentral);

  // Send answers to HR in chunks
  for (let i = 0; i < questions.length; i += 5) {
    const fields = questions.slice(i, i + 5).map(q => ({
      name:   q.label.slice(0, 256),
      value:  (appData.answers[q.id] || '*No answer*').slice(0, 1024),
      inline: false,
    }));
    const chunk = new EmbedBuilder()
      .setColor(config.colors.neutral)
      .setTitle(`Answers ${i + 1}–${Math.min(i + 5, questions.length)}`)
      .addFields(fields)
      .setFooter({ text: 'RCRP Management' });
    if (hrCh) await hrCh.send({ embeds: [chunk] }).catch(() => {});
  }

  // Main HR embed with approve/deny/hold buttons
  const hrEmbed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({ name: 'River City Role Play', iconURL: guild.iconURL() || undefined })
    .setTitle(`New Staff Application — ${category?.label}`)
    .setDescription(
      `**Applicant:** <@${appData.discordId}>\n` +
      `**Channel:** ${channel}\n` +
      `**Submitted:** <t:${Math.floor(Date.now()/1000)}:F>`
    )
    .addFields({ name: 'AI Recommendation', value: aiAnalysis.slice(0, 1024), inline: false })
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app_approve:${channel.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app_deny:${channel.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`app_hold:${channel.id}`).setLabel('On Hold').setStyle(ButtonStyle.Secondary),
  );

  if (hrCh) await hrCh.send({ embeds: [hrEmbed], components: [btnRow] }).catch(() => {});
}

// ── HR Decision ────────────────────────────────────────────
// Deny → shows modal for notes first. Approve/Hold → immediate.
async function handleHRDecision(interaction, decision) {
  const { isStaff } = require('../utils/permissions');
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'You do not have permission to make HR decisions.', ephemeral: true });
  }

  const channelId = interaction.customId.split(':')[1];
  const appData   = activeApps.get(channelId);
  if (!appData) {
    return interaction.reply({ content: 'Application data not found — may already be processed.', ephemeral: true });
  }

  // Deny → pop a modal to collect notes/reason
  if (decision === 'deny') {
    const modal = new ModalBuilder()
      .setCustomId(`app_deny_modal:${channelId}`)
      .setTitle('Deny Application — Add Notes');

    const notesInput = new TextInputBuilder()
      .setCustomId('denial_notes')
      .setLabel('Reason / Notes (shown to applicant)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g. Insufficient experience, safe chat enabled, answers too short...')
      .setMinLength(5)
      .setMaxLength(500)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(notesInput));
    return interaction.showModal(modal);
  }

  // Approve or Hold — process immediately
  await interaction.deferReply({ ephemeral: true });
  await processDecision(interaction, channelId, appData, decision, '');
  await interaction.editReply({ content: `Application marked as **${decision === 'approve' ? 'Approved' : 'On Hold'}**.` });
}

// ── Denial modal submit ────────────────────────────────────
async function handleDenyModal(interaction) {
  const { isStaff } = require('../utils/permissions');
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const channelId = interaction.customId.split(':')[1];
  const appData   = activeApps.get(channelId);
  const notes     = interaction.fields.getTextInputValue('denial_notes');

  if (!appData) return interaction.editReply({ content: 'Application data not found.' });
  await processDecision(interaction, channelId, appData, 'deny', notes);
  await interaction.editReply({ content: 'Application denied.' });
}

// ── Shared decision processor ──────────────────────────────
async function processDecision(interaction, channelId, appData, decision, notes) {
  const guild    = interaction.guild;
  const appCh    = guild.channels.cache.get(channelId);
  const member   = guild.members.cache.get(appData.discordId);
  const category = config.applicationCategories.find(c => c.id === appData.category);
  const reviewer = interaction.user;

  const approved = decision === 'approve';
  const onHold   = decision === 'hold';

  const now        = new Date();
  const reviewedOn = `${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

  // ── Auto-role on approve ────────────────────────────────
  if (approved && member) {
    const roleKey = config.approvalRoles?.[appData.category];
    if (roleKey) {
      const roleId = config.roles[roleKey];
      if (roleId) await member.roles.add(roleId).catch(e => console.error('[Apps] Role:', e.message));
    }
  }

  // ── In-app-channel embed ────────────────────────────────
  const inChannelEmbed = new EmbedBuilder()
    .setColor(approved ? config.colors.success : onHold ? config.colors.warning : config.colors.danger)
    .setTitle(approved ? '✅ Application Approved' : onHold ? '⏸ Application On Hold' : '❌ Application Denied')
    .setDescription(
      approved ? `✅ **Congratulations <@${appData.discordId}>!**\n\nYour **${category?.label}** application has been **APPROVED**! 🎉\n\n${config.approvalRoles?.[appData.category] ? 'Your role has been assigned automatically.' : 'An HR member will assign your role shortly.'}\n\n**Welcome to the River City Role Play team!**` :
      onHold   ? `⏸️ **<@${appData.discordId}>** — your **${category?.label}** application is currently **ON HOLD**.\n\nHR is still reviewing your answers and will follow up shortly. Please be patient.` :
                 `❌ **<@${appData.discordId}>** — your **${category?.label}** application was **not successful** this time.\n\nYou may reapply in **2 weeks**. Keep improving and we hope to see you again!`
    )
    .setFooter({ text: `Reviewed by ${reviewer.username} • RCRP Management` })
    .setTimestamp();

  if (notes) inChannelEmbed.addFields({ name: 'Notes', value: notes, inline: false });
  if (appCh) await appCh.send({ embeds: [inChannelEmbed] }).catch(() => {});

  // ── DM the applicant ────────────────────────────────────
  if (member) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(approved ? config.colors.success : onHold ? config.colors.warning : config.colors.danger)
        .setTitle(approved ? 'Staff Application Accepted — RCRP' : onHold ? 'Application On Hold — RCRP' : 'Staff Application Denied — RCRP')
        .setDescription(
          approved
          ? `🎉 **Your ${category?.label} application was APPROVED!**\n\n` +
            `> ${config.approvalRoles?.[appData.category] ? 'Your role has been assigned.' : 'An HR member will assign your role shortly.'}\n` +
            `> Head to the staff channels for your onboarding.\n` +
            `> Welcome to **River City Role Play** — we are thrilled to have you!\n`
          : onHold
          ? `⏸️ **Your ${category?.label} application is ON HOLD.**\n\n` +
            `> HR is still reviewing your application and will reach out shortly.\n` +
            `> Please be patient and watch your DMs and application channel.`
          : `❌ **Your ${category?.label} application was not successful this time.**\n\n` +
            `> Thank you for your interest in River City Role Play.\n` +
            `> You may reapply in **2 weeks** — keep growing and try again! 💪`
        )
        .setFooter({ text: `Reviewed on: ${reviewedOn} • Reviewed by: ${reviewer.username}` })
        .setTimestamp();
      if (notes) dmEmbed.addFields({ name: 'Notes', value: notes, inline: false });
      await member.send({ embeds: [dmEmbed] });
    } catch {}
  }

  // ── Public result embed (matches screenshot style) ───────
  const resultsCh = guild.channels.cache.get(config.channels.ticketResults);
  if (resultsCh && !onHold) {
    const acceptedImage = process.env.ACCEPTED_IMAGE_URL || null;
    const deniedImage   = process.env.DENIED_IMAGE_URL   || null;

    const pubEmbed = new EmbedBuilder()
      .setColor(approved ? config.colors.success : config.colors.danger)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() || undefined })
      .setTitle(approved ? 'Staff Application Accepted' : 'Staff Application Denied')
      .setDescription(
        approved
          ? `Your Staff application has undergone review by the Directive Team. We are pleased to inform you that your application meets our standards, and you have successfully passed. Congratulations on this achievement!`
          : `Your Staff application has undergone review by the Directive Team. Unfortunately, your application did not meet our standards, and it has been denied.`
      )
      .setFooter({ text: `Reviewed on: ${reviewedOn} • Reviewed by: ${reviewer.username}` })
      .setTimestamp();

    if (notes)                              pubEmbed.addFields({ name: 'Notes', value: notes, inline: false });
    if (approved && acceptedImage)         pubEmbed.setImage(acceptedImage);
    if (!approved && deniedImage)          pubEmbed.setImage(deniedImage);

    // Content = user mention (outside embed, shows above it like in the screenshot)
    await resultsCh.send({ content: `<@${appData.discordId}>`, embeds: [pubEmbed] }).catch(e => console.error('[Apps] Results post:', e.message));
  }

  // ── Archive app channel ──────────────────────────────────
  if (!onHold) {
    activeApps.delete(channelId);
    // Remove buttons from all HR messages in HR channel
    try {
      const hrCh   = guild.channels.cache.get(config.channels.hrCentral);
      const hrMsgs = hrCh ? await hrCh.messages.fetch({ limit: 50 }) : null;
      if (hrMsgs) {
        for (const m of hrMsgs.values()) {
          if (m.author.bot && m.components?.some(r => r.components?.some(c => c.customId === `app_approve:${channelId}`))) {
            await m.edit({ components: [] }).catch(() => {});
            break;
          }
        }
      }
    } catch {}

    // Archive channel after 24h — rename and hide from applicant
    setTimeout(async () => {
      if (appCh) {
        await appCh.setName(`closed-${appCh.name}`.slice(0, 45)).catch(() => {});
        await appCh.permissionOverwrites.edit(appData.discordId, { ViewChannel: false }).catch(() => {});
      }
    }, 24 * 60 * 60 * 1000);
  }
}

// ── Restore on restart ────────────────────────────────────
async function restoreActiveApps(guild) {
  try {
    const hrCh = guild.channels.cache.get(config.channels.hrCentral);
    if (!hrCh) return;
    const msgs = await hrCh.messages.fetch({ limit: 50 });
    for (const msg of msgs.values()) {
      for (const row of (msg.components || [])) {
        for (const comp of row.components) {
          if (comp.customId?.startsWith('app_approve:')) {
            const chId = comp.customId.split(':')[1];
            if (activeApps.has(chId)) continue;
            const appCh = guild.channels.cache.get(chId);
            if (!appCh) continue;
            const catMatch = config.applicationCategories.find(c => appCh.name.includes(c.id));
            if (!catMatch) continue;
            const ow = appCh.permissionOverwrites.cache.find(o => o.type === 1 && o.id !== guild.client.user.id);
            if (!ow) continue;
            const rebuilt = await rebuildAnswers(appCh, catMatch.id);
            activeApps.set(chId, { discordId: ow.id, category: catMatch.id, channelId: chId, answers: rebuilt.answers, step: rebuilt.step, startedAt: msg.createdAt.toISOString() });
            console.log(`[Applications] Restored: ${appCh.name}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Applications] restoreActiveApps:', err.message);
  }
}

async function rebuildAnswers(channel, categoryId) {
  const questions = config.applicationQuestions[categoryId] || [];
  let step = 0;
  const answers = {};
  try {
    const msgs = await channel.messages.fetch({ limit: 100 });
    for (const m of [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)) {
      if (m.author.bot || step >= questions.length) continue;
      answers[questions[step].id] = m.content;
      step++;
    }
  } catch {}
  return { answers, step };
}

module.exports = {
  postApplicationPanel,
  handleApplyButton,
  handleCategorySelect,
  handleApplicationMessage,
  handleHRDecision,
  handleDenyModal,
  restoreActiveApps,
};
