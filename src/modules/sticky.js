// ============================================================
// sticky.js — Sticky Message System
// Keeps a message anchored to the bottom of a channel.
// Admin replies to any message with /sticky to set it.
// ============================================================

const { EmbedBuilder } = require('discord.js');

// In-memory store: channelId → { content, embeds, files, messageId }
const stickyMessages = new Map();

/**
 * Set a sticky message for a channel.
 * @param {string} channelId
 * @param {object} stickyData - { content, embeds, files }
 * @param {string} messageId  - The current bot message ID for this sticky
 */
function setSticky(channelId, stickyData, messageId) {
  stickyMessages.set(channelId, { ...stickyData, messageId });
}

/**
 * Remove the sticky for a channel.
 * @param {string} channelId
 */
function removeSticky(channelId) {
  stickyMessages.delete(channelId);
}

/**
 * Get the sticky data for a channel.
 * @param {string} channelId
 * @returns {object|null}
 */
function getSticky(channelId) {
  return stickyMessages.get(channelId) || null;
}

/**
 * Handle a new message in a channel — repost sticky if one exists.
 * @param {Message} message
 */
async function handleNewMessage(message) {
  if (message.author.bot) return;

  const sticky = getSticky(message.channel.id);
  if (!sticky) return;

  // Don't repost if the new message IS the sticky (shouldn't happen due to bot check)
  if (message.id === sticky.messageId) return;

  // Repost the sticky at the bottom
  try {
    // 1. Delete the old sticky bot message
    const oldMsg = await message.channel.messages.fetch(sticky.messageId).catch(() => null);
    if (oldMsg) await oldMsg.delete().catch(() => {});

    // 2. Send new sticky
    const sent = await message.channel.send({
      content: sticky.content || null,
      embeds:  sticky.embeds  || [],
      files:   sticky.files   || [],
    });

    // 3. Update the map with the new message ID
    sticky.messageId = sent.id;
    stickyMessages.set(message.channel.id, sticky);
  } catch (err) {
    console.error('[Sticky] Failed to repost sticky:', err.message);
  }
}

module.exports = { setSticky, removeSticky, getSticky, handleNewMessage };
