// autoSetup.js — Master auto-configuration module
  // Runs on every bot startup. Posts OR updates all permanent panels.
  // Uses "upsert by footer tag" — edits existing message if found, posts new if not.
  // Result: 0 manual setup commands ever needed. Restart = everything current.
  'use strict';

  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const config       = require('../config');
  const verification = require('./verification');
  const applications = require('./applications');

  let _client = null;

  // Upsert: edit existing bot message with matching footer tag, or post new
  async function upsert(ch, tag, embeds, components) {
    components = components || [];
    if (!ch) return;
    try {
      const msgs = await ch.messages.fetch({ limit: 50 });
      const existing = [...msgs.values()].find(m =>
        m.author.id === _client.user.id &&
        m.embeds.some(e => e.footer && e.footer.text && e.footer.text.includes(tag))
      );
      const payload = { embeds, components };
      if (existing) {
        await existing.edit(payload);
        console.log('[AutoSetup] Updated:', tag, 'in #' + ch.name);
      } else {
        await ch.send(payload);
        console.log('[AutoSetup] Posted:', tag, 'in #' + ch.name);
      }
    } catch (e) {
      console.warn('[AutoSetup] Error in #' + (ch ? ch.name : '?') + ':', e.message);
    }
  }

  function getCh(guild, id) { return id ? guild.channels.cache.get(id) : null; }

  // ── 1. Verification → #verification ──────────────────────
  async function runVerify(guild) {
    const ch = getCh(guild, config.channels.verification);
    if (!ch) { console.warn('[AutoSetup] #verification not found'); return; }
    await verification.postVerifyPanel(ch).catch(e => console.warn('[AutoSetup] Verify:', e.message));
  }

  // ── 2. Applications → #applications ──────────────────────
  async function runApplications(guild) {
    const ch = getCh(guild, config.channels.applications);
    if (!ch) { console.warn('[AutoSetup] #applications not found'); return; }
    await applications.postApplicationPanel(ch).catch(e => console.warn('[AutoSetup] Apps:', e.message));
  }

  // ── 3. Self-roles → #self-roles ───────────────────────────
  async function runSelfRoles(guild) {
    const ch = getCh(guild, config.channels.selfRoles);
    if (!ch) return;
    const r = config.roles;
    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('🎭  Self Roles — Florida State Roleplay')
      .setDescription(
        '> Pick your **department** and **notification preferences** below.\n' +
        '> Click a role again to **remove it**.'
      )
      .addFields(
        { name: '🚔 Departments', value:
          '<@&' + r.leo      + '> — Law Enforcement Officer\n' +
          '<@&' + r.fireDept + '> — Fire & EMS Services\n' +
          '<@&' + r.dot      + '> — Department of Transportation\n' +
          '<@&' + r.civilian + '> — Civilian Roleplay',
          inline: false },
        { name: '🔔 Notification Roles', value:
          '<@&' + r.sessionPing  + '> — Live session alerts\n' +
          '<@&' + r.giveawayPing + '> — Giveaway announcements\n' +
          '<@&' + r.mediaPing    + '> — Media team content\n' +
          '<@&' + r.ssuPing      + '> — SSU callouts',
          inline: false },
      )
      .setFooter({ text: 'FSRP:selfroles:panel — Florida State Roleplay' })
      .setTimestamp();
    const deptRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('selfrole:' + r.leo).setLabel('LEO').setEmoji('🚔').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('selfrole:' + r.fireDept).setLabel('Fire / EMS').setEmoji('🚒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('selfrole:' + r.dot).setLabel('DOT').setEmoji('🚧').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('selfrole:' + r.civilian).setLabel('Civilian').setEmoji('🚲').setStyle(ButtonStyle.Secondary),
    );
    const pingRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('selfrole:' + r.sessionPing).setLabel('Session Pings').setEmoji('🔔').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('selfrole:' + r.giveawayPing).setLabel('Giveaway Pings').setEmoji('🎉').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('selfrole:' + r.mediaPing).setLabel('Media Pings').setEmoji('📸').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('selfrole:' + r.ssuPing).setLabel('SSU Pings').setEmoji('🔊').setStyle(ButtonStyle.Success),
    );
    await upsert(ch, 'FSRP:selfroles:panel', [embed], [deptRow, pingRow]);
  }

  // ── 4. Staff review → #staff-review ──────────────────────
  async function runReviewPanel(guild) {
    const ch = getCh(guild, config.channels.staffReview);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(config.colors.gold)
      .setTitle('\u2b50  Staff Performance Review — FSRP')
      .setDescription(
        '> Submit a formal review of any FSRP staff member.\n' +
        '> **All reviews are confidential — reviewed by management only.**\n\n' +
        '**Guidelines:**\n' +
        '• Be specific — include the date, time, and what occurred\n' +
        '• Positive reviews are encouraged and taken seriously\n' +
        '• False reports are a punishable offence'
      )
      .setFooter({ text: 'FSRP:review:panel — Florida State Roleplay' })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('leave_review').setLabel('Submit a Review').setEmoji('\u2b50').setStyle(ButtonStyle.Primary),
    );
    await upsert(ch, 'FSRP:review:panel', [embed], [row]);
  }

  // ── 5. Welcome → #welcome ─────────────────────────────────
  async function runWelcome(guild) {
    const ch = getCh(guild, config.channels.welcome);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(config.colors.blue)
      .setTitle('\ud83d\udce5  Welcome to Florida State Roleplay')
      .setDescription(
        '> You are part of a **' + guild.memberCount.toLocaleString() + '-member** professional ERLC community.\n' +
        '> FSRP is a serious, whitelisted server focused on realistic roleplay.'
      )
      .addFields(
        { name: 'Step 1 — Verify', value: 'Link your Roblox account in <#' + config.channels.verification + '> to access all features.', inline: false },
        { name: 'Step 2 — Grab Roles', value: 'Pick department and notification roles in <#' + config.channels.selfRoles + '>.', inline: false },
        { name: 'Step 3 — Read the Rules', value: '<#' + config.channels.discordRules + '> Discord Rules\n<#' + config.channels.gameRules + '> Game Rules\n<#' + config.channels.leoRules + '> LEO Rules', inline: false },
        { name: 'Step 4 — Play', value: 'Watch <#' + config.channels.sessionAnnouncements + '> for sessions. Chat in <#' + config.channels.general + '>.', inline: false },
        { name: 'Need Help?', value: 'Ticket: <#' + config.channels.support + '>\nBan Appeal: <#' + config.channels.banAppeals + '>', inline: false },
      )
      .setFooter({ text: 'FSRP:welcome:panel — Florida State Roleplay' })
      .setTimestamp();
    await upsert(ch, 'FSRP:welcome:panel', [embed], []);
  }

  // ── 6. Commands help → #commands ──────────────────────────
  async function runCommandsHelp(guild) {
    const ch = getCh(guild, config.channels.commands);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('🤖  FSRP Bot — Command Reference')
      .setDescription('[Staff] = Staff only  •  [Management] = Management/HR  •  No tag = anyone')
      .addFields(
        { name: '👤 Community', value:
          '/member mystats — Your in-game stats\n' +
          '/member where — Your last known location\n' +
          '/member mycar — Your current vehicle\n' +
          '/member vouch @user — Vouch for a member (1/day)\n' +
          '/member scenario — Random RP training scenario\n' +
          '/rep give @user — Give +1 community rep\n' +
          '/rep view — View a rep profile',
          inline: false },
        { name: '🎮 [Staff] ERLC', value:
          '/game overview — Full live server snapshot\n' +
          '/game players — Everyone currently in-server\n' +
          '/game staff — On-duty staff list\n' +
          '/game run <cmd> — Execute ERLC command\n' +
          '/erlc players | /erlc staff | /erlc info',
          inline: false },
        { name: '🛡️ [Staff] Staff', value:
          '/staff warn @member — Issue a formal warning\n' +
          '/staff callout — Post dept callout to MDT\n' +
          '/staff log — Log a staff action\n' +
          '/loa request — Submit LOA • /loa view — Active LOAs\n' +
          '/promote @member <role> — Promote or demote staff\n' +
          '/review leave — Review a staff member',
          inline: false },
        { name: '⚙️ [Management] Admin', value:
          '/management strike/warn/note/fire\n' +
          '/intel <username> — Deep player intel report\n' +
          '/internal-ask <query> — AI evidence search\n' +
          '/broadcast <type> — Styled server announcement\n' +
          '/fsrp status — Bot system status\n' +
          '/fsrp refresh — Force re-run all auto panels\n' +
          '/fsrp index — Force re-index AI knowledge',
          inline: false },
      )
      .setFooter({ text: 'FSRP:commands:panel — FSRP Management Bot' })
      .setTimestamp();
    await upsert(ch, 'FSRP:commands:panel', [embed], []);
  }

  // ── 7. Staff rules → #staff-rules ────────────────────────
  async function runStaffRules(guild) {
    const ch = getCh(guild, config.channels.staffRules);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(config.colors.danger)
      .setTitle('📜  Staff Code of Conduct — Florida State Roleplay')
      .setDescription(
        '> All FSRP staff are held to the **highest standard of professionalism**.\n' +
        '> Non-compliance results in disciplinary action up to immediate removal.'
      )
      .addFields(
        { name: '§1  Professionalism', value: 'Conduct yourself with maturity and respect at all times — in-game, in Discord, and in public.', inline: false },
        { name: '§2  Power Abuse', value: 'Abuse of staff permissions for personal gain or entertainment is an immediate strike.', inline: false },
        { name: '§3  Confidentiality', value: 'Internal staff matters, HR decisions, and disciplinary records are strictly confidential.', inline: false },
        { name: '§4  Chain of Command', value: 'Escalate through proper channels. Never act unilaterally on matters above your authority.', inline: false },
        { name: '§5  Activity', value: 'Maintain regular activity. Extended absences require a formal LOA via /loa request.', inline: false },
        { name: '§6  Impartiality', value: 'All members are treated equally regardless of rank or friendship. No favouritism.', inline: false },
        { name: '§7  Action Logging', value: 'Every staff action must be logged. Unlogged actions may be treated as abuse.', inline: false },
        { name: '§8  Strike System', value: 'Strike 1 — Formal warning + note\nStrike 2 — Demotion or suspension\nStrike 3 — Immediate removal from staff', inline: false },
      )
      .setFooter({ text: 'FSRP:staffrules:panel — Florida State Roleplay Management' })
      .setTimestamp();
    await upsert(ch, 'FSRP:staffrules:panel', [embed], []);
  }

  // ── 8. Dept updates → #dept-updates ──────────────────────
  async function runDeptUpdates(guild) {
    const ch = getCh(guild, config.channels.deptUpdates);
    if (!ch) return;
    const r = config.roles;
    const embed = new EmbedBuilder()
      .setColor(config.colors.blue)
      .setTitle('🚨  Department Updates — FSRP')
      .setDescription(
        '> Official department announcements, roster changes, and unit updates.\n' +
        '> **Department leadership and management only may post here.**'
      )
      .addFields(
        { name: 'Law Enforcement', value: '<@&' + r.leo      + '>', inline: true },
        { name: 'Fire & EMS',      value: '<@&' + r.fireDept + '>', inline: true },
        { name: 'DOT',             value: '<@&' + r.dot      + '>', inline: true },
        { name: 'S.W.A.T',        value: '<@&' + r.swat     + '>', inline: true },
      )
      .setFooter({ text: 'FSRP:deptupdates:panel — Florida State Roleplay' })
      .setTimestamp();
    await upsert(ch, 'FSRP:deptupdates:panel', [embed], []);
  }

  // ── 9. Whitelist chat → #whitelist-chat ──────────────────
  async function runWhitelistChat(guild) {
    const ch = getCh(guild, config.channels.whitelistChat);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle('✅  Whitelisted Members — Florida State Roleplay')
      .setDescription(
        '> You have been approved for FSRP private servers. Welcome to the whitelist.\n\n' +
        'Session Announcements: <#' + config.channels.sessionAnnouncements + '>\n' +
        'Session Ping Role: <#' + config.channels.selfRoles + '>\n\n' +
        '*Whitelist may be revoked for serious in-game rule violations without prior warning.*'
      )
      .setFooter({ text: 'FSRP:whitelist:panel — Florida State Roleplay' })
      .setTimestamp();
    await upsert(ch, 'FSRP:whitelist:panel', [embed], []);
  }

  // ── 10. IA handbook → #iahandbook ────────────────────────
  async function runIAHandbook(guild) {
    const ch = getCh(guild, config.channels.iaHandbook);
    if (!ch) return;
    const r = config.roles;
    const embed = new EmbedBuilder()
      .setColor(config.colors.purple)
      .setTitle('⚖️  Internal Affairs — Florida State Roleplay')
      .setDescription(
        '> IA exists to ensure staff accountability, fairness, and integrity at all levels.\n' +
        '> All investigations are strictly confidential.'
      )
      .addFields(
        { name: 'IA Team', value:
          '<@&' + r.iaDirector      + '> — IA Director\n' +
          '<@&' + r.internalAffairs + '> — Internal Affairs\n' +
          '<@&' + r.trialIA         + '> — Trial IA',
          inline: false },
        { name: 'Filing a Report', value:
          '1. Open a ticket in <#' + config.channels.support + '>\n' +
          '2. State it is an Internal Affairs matter\n' +
          '3. Provide evidence (screenshots, video, logs)\n' +
          '4. IA will contact you privately within 24 hours',
          inline: false },
        { name: 'False Reports', value: 'Filing a false IA report is a serious offence and may result in a permanent ban.', inline: false },
      )
      .setFooter({ text: 'FSRP:iahandbook:panel — Florida State Roleplay' })
      .setTimestamp();
    await upsert(ch, 'FSRP:iahandbook:panel', [embed], []);
  }

  // ── MAIN RUNNER ───────────────────────────────────────────
  async function run(client, guild) {
    _client = client;
    console.log('[AutoSetup] Configuring ' + guild.name + ' (' + guild.memberCount + ' members)...');
    await Promise.allSettled([
      runVerify(guild),
      runApplications(guild),
      runSelfRoles(guild),
      runReviewPanel(guild),
      runWelcome(guild),
      runCommandsHelp(guild),
      runStaffRules(guild),
      runDeptUpdates(guild),
      runWhitelistChat(guild),
      runIAHandbook(guild),
    ]);
    console.log('[AutoSetup] All panels configured.');
  }

  module.exports = { run };
  