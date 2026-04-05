// ============================================================
// deploy-commands.js — Register slash commands with Discord
// Run once: node src/deploy-commands.js
// Or it runs automatically on bot startup.
// ============================================================

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

async function deployCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) {
      commands.push(command.data.toJSON());
      console.log(`[Deploy] Loaded command: ${command.data.name}`);
    }
  }

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);

  try {
    console.log(`[Deploy] Registering ${commands.length} slash commands...`);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('[Deploy] ✅ All slash commands registered successfully!');
  } catch (err) {
    console.error('[Deploy] ❌ Failed to register commands:', err);
    throw err;
  }
}

module.exports = { deployCommands };

// Allow direct execution
if (require.main === module) {
  deployCommands().catch(console.error);
}
