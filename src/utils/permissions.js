// permissions.js — Role-based permission checks
// Admin permission ALWAYS grants access to everything.
// Staff = any configured staff role OR Discord Administrator.

const config = require('../config');
const { PermissionFlagsBits } = require('discord.js');

function hasAnyRole(member, roleIds) {
  const validIds = (roleIds || []).filter(id => id && id.length > 0);
  if (!validIds.length) return false;
  return validIds.some(id => member.roles.cache.has(id));
}

const isAdmin = m =>
  m.permissions.has(PermissionFlagsBits.Administrator);

const isOwner = m =>
  isAdmin(m) ||
  hasAnyRole(m, [config.roles.owner, config.roles.coOwner].filter(Boolean));

const isManagement = m =>
  isAdmin(m) || hasAnyRole(m, config.managementRoles);

// ALL staff commands are accessible to Administrator + any staff role
const isStaff = m =>
  isAdmin(m) || hasAnyRole(m, config.staffRoles);

const isHR = m =>
  isAdmin(m) || hasAnyRole(m, config.hrRoles);

const isVerified = m => {
  const rid = config.roles.verified;
  if (!rid) return true; // If role not configured, assume verified
  return m.roles.cache.has(rid);
};

async function denyPermission(interaction, required = 'Staff') {
  const msg = { content: `You need the **${required}** role to use this command.`, ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) return interaction.editReply(msg);
    return interaction.reply(msg);
  } catch { /* ignore */ }
}

module.exports = { hasAnyRole, isAdmin, isOwner, isManagement, isStaff, isHR, isVerified, denyPermission };
