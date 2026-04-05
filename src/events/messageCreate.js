// messageCreate.js — Message event handler
const applications  = require('../modules/applications');
const mentionHandler = require('../modules/mentionHandler');
const serverBrain   = require('../modules/serverBrain');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    // If bot is mentioned: respond AND learn immediately
    if (message.mentions.has(client.user)) {
      // Learn from the message (non-blocking)
      serverBrain.learnFromMessage(message).catch(() => {});
      return mentionHandler.handleMention(message).catch(err =>
        console.error('[MessageCreate] MentionHandler error:', err.message)
      );
    }

    // Passively learn from messages in non-private channels (non-blocking)
    serverBrain.learnFromMessage(message).catch(() => {});

    // Route to application Q&A handler
    await applications.handleApplicationMessage(message, client).catch(err =>
      console.error('[MessageCreate] Application handler error:', err.message)
    );
  },
};
