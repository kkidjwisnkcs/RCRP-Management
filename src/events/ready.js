// ready.js — Bot startup
const config       = require('../config');
const heartbeat    = require('../modules/heartbeat');
const shiftCards   = require('../modules/shiftCards');
const dbScanner    = require('../modules/dbScanner');
const verification = require('../modules/verification');
const applications = require('../modules/applications');
const erlc         = require('../utils/erlc');
const embeds       = require('../utils/embeds');
const wantedWall   = require('../modules/crimeTickerWall');
const mapPinner    = require('../modules/mapPinner');
const crimeTicker  = require('../modules/crimeTicker');
const dailyReport  = require('../modules/dailyReport');
const vouchSystem  = require('../modules/vouchSystem');
const dutySignup   = require('../modules/dutySignup');
const serverBrain  = require('../modules/serverBrain');
const staffCal     = require('../modules/staffCalendar');
const { deployCommands }  = require('../deploy-commands');
const intelSystem         = require('../modules/intelSystem');
const reputationSystem    = require('../modules/reputationSystem');
const { ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log('\n✅ RCRP Management online as ' + client.user.tag);
    console.log('📡 Guild: ' + process.env.GUILD_ID);
    console.log('🕐 ' + new Date().toISOString() + '\n');

    client.user.setPresence({ activities: [{ name: 'River City Role Play', type: ActivityType.Watching }], status: 'online' });

    try { await deployCommands(); } catch (e) { console.error('[Ready] Deploy error:', e.message); }

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) { console.error('[Ready] Guild not found — check GUILD_ID!'); return; }

    await guild.members.fetch().catch(e => console.warn('[Ready] Member fetch:', e.message));

    erlc.testConnection().catch(() => {});

    // Post verification panel
    const verifyCh = guild.channels.cache.find(c => c.isTextBased() && /^verify(?!.*(?:database|db))/i.test(c.name));
    if (verifyCh) await verification.postVerifyPanel(verifyCh).catch(e => console.warn('[Ready] Verify panel:', e.message));

    // Post application panel
    const appCh = guild.channels.cache.get(config.channels.staffApplications);
    if (appCh) await applications.postApplicationPanel(appCh).catch(e => console.warn('[Ready] App panel:', e.message));

    await applications.restoreActiveApps(guild).catch(e => console.warn('[Ready] App restore:', e.message));

    // Post self-roles panel
    await postSelfRolesPanel(client, guild);

    // Post staff review panel
    await postReviewPanel(client, guild);

    // Init shift cards (clears old messages, ready for heartbeat updates)
    await shiftCards.init(client).catch(e => console.warn('[Ready] ShiftCards init:', e.message));

    // Latch onto existing wanted wall + map messages
    await wantedWall.findExistingWantedWall(client).catch(() => {});
    await mapPinner.findExistingMessage(client).catch(() => {});

    // Init new modules
    crimeTicker.init(client);
    vouchSystem.init(client);
    dutySignup.init(client);
    staffCal.init(client);
    dailyReport.init(client);

    // Start ERLC heartbeat (20s poll)
    heartbeat.start(client);
    intelSystem.init(client);
    reputationSystem.init(client);

    // Start DB scanner (60s channel index)
    dbScanner.start(client);

    // Start server brain (scans channels every 2 min, learns from messages)
    serverBrain.init(client);

    console.log('🚀 RCRP Management fully operational.\n');
  },
};

async function postSelfRolesPanel(client, guild) {
  try {
    const ch = guild.channels.cache.get(config.channels.selfRoles);
    if (!ch) return console.warn('[Ready] Self-roles channel not found:', config.channels.selfRoles);

    const msgs = await ch.messages.fetch({ limit: 20 });
    const exists = [...msgs.values()].find(m =>
      m.author.id === client.user.id &&
      m.components.length > 0 &&
      m.components[0]?.components?.some(c => c.customId?.startsWith('selfrole:'))
    );
    if (exists) return console.log('[Ready] Self-roles panel already posted.');

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
    console.log('[Ready] Self-roles panel posted.');
  } catch (e) {
    console.warn('[Ready] Self-roles panel error:', e.message);
  }
}

async function postReviewPanel(client, guild) {
  try {
    const ch = guild.channels.cache.get(config.channels.staffReview);
    if (!ch) return console.warn('[Ready] Staff review channel not found:', config.channels.staffReview);

    const msgs = await ch.messages.fetch({ limit: 20 });
    const exists = [...msgs.values()].find(m =>
      m.author.id === client.user.id &&
      m.components.length > 0 &&
      m.components[0]?.components?.some(c => c.customId === 'leave_review')
    );
    if (exists) return console.log('[Ready] Review panel already posted.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('leave_review').setLabel('⭐ Leave a Review').setStyle(ButtonStyle.Primary)
    );
    await ch.send({ embeds: [embeds.reviewPanel()], components: [row] });
    console.log('[Ready] Review panel posted.');
  } catch (e) {
    console.warn('[Ready] Review panel error:', e.message);
  }
}
