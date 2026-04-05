// mentionHandler.js — @RCRP Management AI responder
// Triggers on-demand index if needed, answers with channel citations.

const config    = require('../config');
const db        = require('../utils/discordDb');
const ai        = require('../utils/ai');
const dbScanner = require('./dbScanner');

async function handleMention(message) {
  if (message.author.bot || !message.guild) return;

  const question = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!question) {
    return message.reply('Ask me anything about the server — rules, your history, applications, who is online, anything.');
  }

  await message.channel.sendTyping();

  try {
    // Ensure the scanner has indexed channels — trigger a scan if it hasn't run recently
    await dbScanner.ensureIndexed();

    const context = dbScanner.getContextForQuery(question);
    const history = await getUserHistory(message.member, message.guild);
    const answer  = await ai.answerQuestion(question, context, history, message.member.displayName);

    const reply = answer || "I couldn't find enough information about that. Try asking a staff member!";

    // Split long replies
    if (reply.length <= 1990) {
      return message.reply({ content: reply, allowedMentions: { repliedUser: true } });
    }

    const chunks = splitText(reply, 1990);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) await message.reply({ content: chunks[i], allowedMentions: { repliedUser: true } });
      else await message.channel.send(chunks[i]);
    }

  } catch (err) {
    console.error('[MentionHandler]', err.message);
    await message.reply('Something went wrong. Please try again!').catch(() => {});
  }
}

function splitText(text, maxLen) {
  const chunks = [];
  const lines  = text.split('\n');
  let cur = '';
  for (const line of lines) {
    if ((cur + '\n' + line).length > maxLen) { if (cur) chunks.push(cur); cur = line; }
    else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function getUserHistory(member, guild) {
  try {
    const verifyCh = guild.channels.cache.get(config.channels.verifyDatabase);
    if (!verifyCh) return '';

    const { users } = await db.getVerifyDb(verifyCh);
    const entry = users.find(u => u.discordId === member.id && u.status === 'active');
    if (!entry) return `${member.displayName} is not verified in the RCRP database.`;

    const robloxId = String(entry.robloxId);
    const gameCh   = guild.channels.cache.get(config.channels.gameDatabase);
    if (!gameCh) return `Roblox: ${entry.robloxUsername} (${robloxId}).`;

    const files       = await db.readAllFiles(gameCh, null, 50);
    const appearances = [];
    for (const f of files) {
      const p = (f.data?.players || []).find(pl => String(pl.userId || pl._userId) === robloxId);
      if (p) appearances.push({ ts: f.data?._meta?.timestamp || new Date(f.timestamp).toISOString(), team: p.team || p._team || '?', vehicle: p.vehicle || p._vehicle || 'On foot', callsign: p.callsign || p._callsign || 'N/A' });
    }

    if (!appearances.length) return `Roblox: ${entry.robloxUsername} (${robloxId}). No game sessions recorded yet.`;

    const last     = appearances[appearances.length - 1];
    const teams    = [...new Set(appearances.map(a => a.team))];
    const vehicles = [...new Set(appearances.map(a => a.vehicle).filter(v => v !== 'On foot'))];

    return `Roblox: ${entry.robloxUsername} (${robloxId})\nVerified: ${entry.verifiedAt}\nSessions: ${appearances.length}\nLast seen: ${last.ts}\nLast team: ${last.team} | Callsign: ${last.callsign}\nTeams: ${teams.join(', ')}\nVehicles: ${vehicles.join(', ') || 'None'}`;
  } catch (err) {
    console.error('[MentionHandler] getUserHistory:', err.message);
    return '';
  }
}

module.exports = { handleMention };
