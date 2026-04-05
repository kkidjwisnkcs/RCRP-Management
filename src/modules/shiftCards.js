// shiftCards.js — Live staff shift cards in ERLC stats channel
  // Posts one embed per in-game verified staff member, updates every heartbeat.

  const config = require('../config');
  const embeds = require('../utils/embeds');

  // robloxId -> { discordId, robloxUsername, messageId, startTime, modCallCount, lastTeam, lastCallsign }
  const shifts = new Map();

  let _client  = null;

  async function init(client) {
    _client = client;
    const ch = client.channels.cache.get(config.channels.shiftCards);
    if (!ch) { console.warn('[ShiftCards] Channel not found:', config.channels.shiftCards); return; }

    try {
      let fetched;
      do {
        fetched = await ch.messages.fetch({ limit: 100 });
        const mine = fetched.filter(m => m.author.id === client.user.id);
        if (mine.size === 0) break;
        await Promise.all([...mine.values()].map(m => m.delete().catch(() => {})));
      } while (fetched.size === 100);
    } catch (e) { console.warn('[ShiftCards] Init clear error:', e.message); }

    console.log('[ShiftCards] Initialized.');
  }

  async function update(snapshot, verifiedUsers, guild) {
    if (!_client) return;
    const ch = _client.channels.cache.get(config.channels.shiftCards);
    if (!ch) return;

    const staffRoleSet = new Set(config.staffRoles);
    const inGameById   = new Map((snapshot.players || []).map(p => [p._userId, p]));

    for (const user of verifiedUsers) {
      const member = guild.members.cache.get(user.discordId);
      if (!member) continue;

      const isStaff = staffRoleSet.size ? [...staffRoleSet].some(rid => member.roles.cache.has(rid)) : false;
      if (!isStaff) continue;

      const player  = inGameById.get(String(user.robloxId));
      const inGame  = Boolean(player);
      const tracked = shifts.get(String(user.robloxId));

      if (inGame && !tracked) {
        // Shift started
        try {
          const embed = embeds.shiftCard(member, user, player, 0, 0, true, null, null);
          const msg   = await ch.send({ embeds: [embed] });
          shifts.set(String(user.robloxId), {
            discordId:     user.discordId,
            robloxUsername: user.robloxUsername,
            messageId:     msg.id,
            startTime:     Date.now(),
            modCallCount:  0,
            lastTeam:      player._team || '?',
            lastCallsign:  player._callsign || 'N/A',
          });
        } catch (e) { console.warn('[ShiftCards] Post error:', e.message); }

      } else if (inGame && tracked) {
        // Update card
        tracked.lastTeam     = player._team     || tracked.lastTeam;
        tracked.lastCallsign = player._callsign || tracked.lastCallsign;
        const dur = Math.floor((Date.now() - tracked.startTime) / 60000);
        try {
          const msg = await ch.messages.fetch(tracked.messageId).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embeds.shiftCard(member, user, player, dur, tracked.modCallCount, true, tracked.lastTeam, tracked.lastCallsign)] });
          }
        } catch {}

      } else if (!inGame && tracked) {
        // Shift ended — show grey off-duty card for 10 minutes then delete
        const dur = Math.floor((Date.now() - tracked.startTime) / 60000);
        try {
          const msg = await ch.messages.fetch(tracked.messageId).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embeds.shiftCard(member, user, null, dur, tracked.modCallCount, false, tracked.lastTeam, tracked.lastCallsign)] });
            setTimeout(() => msg.delete().catch(() => {}), 10 * 60 * 1000);
          }
        } catch {}
        shifts.delete(String(user.robloxId));
      }
    }
  }

  function incrementModCall(robloxId) {
    const t = shifts.get(String(robloxId));
    if (t) t.modCallCount++;
  }

  function getShiftData() { return shifts; }

  module.exports = { init, update, incrementModCall, getShiftData };
  