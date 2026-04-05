// mapPinner.js — ERLC Criminal Location Map
  // Posts/edits ONE message in the MDT channel every 2 min.
  // Uses canvas for image generation. Falls back to a generated schematic if the base map
  // URL fails or canvas is unavailable. Never spams — always edits the same message.
  'use strict';

  const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
  const config = require('../config');

  let _client  = null;
  let mapMsgId = null;

  // Canvas lazy-load
  let _canvas;
  function cv() {
    if (!_canvas) {
      try { _canvas = require('canvas'); } catch { _canvas = null; }
    }
    return _canvas;
  }

  // Base map cache
  let _baseMapBuffer = null;
  let _baseMapFailed = false;

  const MAP    = config.mapCoords || { minX: -3500, maxX: 3500, minZ: -3500, maxZ: 3500 };
  const MAP_W  = 1024;
  const MAP_H  = 1024;

  function worldToPixel(x, z) {
    const px = Math.round(((x - MAP.minX) / (MAP.maxX - MAP.minX)) * MAP_W);
    const py = Math.round(((z - MAP.minZ) / (MAP.maxZ - MAP.minZ)) * MAP_H);
    return {
      px: Math.max(6, Math.min(MAP_W - 6, px)),
      py: Math.max(6, Math.min(MAP_H - 6, py)),
    };
  }

  async function fetchBaseMap() {
    if (_baseMapBuffer) return _baseMapBuffer;
    if (_baseMapFailed)  return null;
    const url = config.mapImageUrl;
    if (!url || url.includes('placeholder')) { _baseMapFailed = true; return null; }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RCRP-Bot)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) { _baseMapFailed = true; return null; }
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('image') && !ct.includes('octet')) { _baseMapFailed = true; return null; }
      _baseMapBuffer = Buffer.from(await response.arrayBuffer());
      console.log('[MapPinner] Base map downloaded: ' + _baseMapBuffer.length + ' bytes');
      return _baseMapBuffer;
    } catch (err) {
      console.warn('[MapPinner] Base map download failed: ' + err.message + '. Using schematic.');
      _baseMapFailed = true;
      return null;
    }
  }

  // Generate a clean schematic map with grid + dots (no base image needed)
  async function buildSchematicMap(wanted, allPlayers) {
    const lib = cv();
    if (!lib) return null;
    try {
      const { createCanvas } = lib;
      const canvas = createCanvas(MAP_W, MAP_H);
      const ctx    = canvas.getContext('2d');

      // Background gradient (dark navy → dark blue)
      const bg = ctx.createLinearGradient(0, 0, MAP_W, MAP_H);
      bg.addColorStop(0, '#0d1117');
      bg.addColorStop(1, '#161b22');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, MAP_W, MAP_H);

      // Grid lines (postal code zones)
      ctx.strokeStyle = 'rgba(30, 215, 96, 0.08)';
      ctx.lineWidth   = 1;
      const gridStep  = Math.round(MAP_W / 14);
      for (let x = 0; x <= MAP_W; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke();
      }
      for (let y = 0; y <= MAP_H; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke();
      }

      // All players — small white dots
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (const p of (allPlayers || [])) {
        const loc = p._location;
        if (!loc || loc.LocationX == null) continue;
        const { px, py } = worldToPixel(loc.LocationX, loc.LocationZ);
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
      }

      // Wanted players — glowing red dots with labels
      for (const p of wanted) {
        const loc = p._location;
        if (!loc || loc.LocationX == null || loc.LocationZ == null) continue;
        const { px, py } = worldToPixel(loc.LocationX, loc.LocationZ);
        const stars      = Math.min(p._wantedStars || 1, 5);
        const radius     = 6 + stars * 2; // bigger dot = more stars

        // Outer glow
        const grad = ctx.createRadialGradient(px, py, radius * 0.2, px, py, radius * 3);
        grad.addColorStop(0,   'rgba(255, 30, 30, 0.8)');
        grad.addColorStop(0.4, 'rgba(200, 0,  0,  0.4)');
        grad.addColorStop(1,   'rgba(200, 0,  0,  0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, radius * 3, 0, Math.PI * 2); ctx.fill();

        // Solid core
        ctx.fillStyle   = '#ff3232';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Star pips
        ctx.fillStyle = '#FFD700';
        ctx.font      = 'bold 9px Arial';
        ctx.fillText('★'.repeat(stars), px - (stars * 5), py - radius - 4);

        // Name label background
        const name = (p._username || 'Unknown').slice(0, 20);
        ctx.font    = 'bold 10px Arial';
        const tw    = ctx.measureText(name).width;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(px - tw / 2 - 3, py + radius + 2, tw + 6, 13);
        ctx.fillStyle   = '#ffffff';
        ctx.textAlign   = 'center';
        ctx.fillText(name, px, py + radius + 12);
        ctx.textAlign   = 'left';
      }

      // Header bar
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, MAP_W, 36);

      ctx.fillStyle = '#ff3232';
      ctx.beginPath(); ctx.arc(16, 18, 7, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font      = 'bold 14px Arial';
      ctx.fillText('LIBERTY COUNTY — LIVE CRIMINAL MAP', 30, 22);

      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font      = '10px Arial';
      const nowStr  = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      ctx.fillText('Updated ' + nowStr + '  •  ' + wanted.length + ' wanted  •  ' + (allPlayers||[]).length + ' total players', 30, 34);

      // Footer legend
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, MAP_H - 22, MAP_W, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font      = '9px Arial';
      ctx.fillText('⬤ = All Players    🔴 = Wanted Criminals    ★ = Wanted Stars    RCRP Automated Map System', 8, MAP_H - 7);

      return canvas.toBuffer('image/png');
    } catch (err) {
      console.error('[MapPinner] schematic error:', err.message);
      return null;
    }
  }

  // Try to draw on top of a real base map image
  async function buildOverlayMap(wanted, allPlayers) {
    const lib = cv();
    if (!lib) return null;
    try {
      const baseBuffer = await fetchBaseMap();
      if (!baseBuffer) return buildSchematicMap(wanted, allPlayers);

      const { createCanvas, loadImage } = lib;
      const img    = await loadImage(baseBuffer);
      const canvas = createCanvas(MAP_W, MAP_H);
      const ctx    = canvas.getContext('2d');

      ctx.drawImage(img, 0, 0, MAP_W, MAP_H);

      // All players
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (const p of (allPlayers || [])) {
        const loc = p._location;
        if (!loc || loc.LocationX == null) continue;
        const { px, py } = worldToPixel(loc.LocationX, loc.LocationZ);
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      }

      // Wanted players
      for (const p of wanted) {
        const loc = p._location;
        if (!loc || loc.LocationX == null) continue;
        const { px, py } = worldToPixel(loc.LocationX, loc.LocationZ);
        const stars = Math.min(p._wantedStars || 1, 5);
        const radius = 7 + stars * 2;

        const grad = ctx.createRadialGradient(px, py, 2, px, py, radius * 2.5);
        grad.addColorStop(0,   'rgba(255,40,40,0.9)');
        grad.addColorStop(0.5, 'rgba(200,0,0,0.5)');
        grad.addColorStop(1,   'rgba(200,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, radius * 2.5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle   = '#ff3232';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#FFD700';
        ctx.font      = 'bold 9px Arial';
        ctx.fillText('★'.repeat(stars), px - stars * 5, py - radius - 3);

        const name = (p._username || 'Unknown').slice(0, 20);
        ctx.font    = 'bold 10px Arial';
        const tw    = ctx.measureText(name).width;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(px - tw / 2 - 3, py + radius + 1, tw + 6, 13);
        ctx.fillStyle   = '#fff';
        ctx.textAlign   = 'center';
        ctx.fillText(name, px, py + radius + 11);
        ctx.textAlign   = 'left';
      }

      return canvas.toBuffer('image/png');
    } catch (err) {
      console.error('[MapPinner] overlay error:', err.message + '. Falling back to schematic.');
      _baseMapFailed  = true;
      _baseMapBuffer  = null;
      return buildSchematicMap(wanted, allPlayers);
    }
  }

  async function pulse(snapshot) {
    try {
      if (!_client) return;
      const ch = _client.channels.cache.get(config.channels.mapChannel);
      if (!ch) return;

      const wanted    = (snapshot.players || []).filter(p => (p._wantedStars || 0) > 0);
      const allPlayer = snapshot.players || [];

      // Always generate some kind of image
      const imgBuffer = await buildOverlayMap(wanted, allPlayer);

      const embed = new EmbedBuilder()
        .setColor(config.colors.danger)
        .setTitle('🗺️  River City — Live Criminal Map')
        .setDescription(
          wanted.length === 0
            ? '✅ **City is clear.** No active wanted criminals.'
            : wanted.map(p => {
                const loc   = p._location;
                const pos   = loc ? 'Postal **' + (loc.PostalCode || '?') + '** — ' + (loc.StreetName || '?') : 'Location unknown';
                const stars = '⭐'.repeat(Math.min(p._wantedStars, 5));
                const veh   = p._vehicle ? ' • ' + p._vehicle : '';
                return stars + ' **' + p._username + '** — ' + pos + veh;
              }).join('\n')
        )
        .addFields(
          { name: 'Active Criminals', value: String(wanted.length), inline: true },
          { name: 'Total Players',    value: String(allPlayer.length), inline: true },
          { name: 'Last Updated',     value: '<t:' + Math.floor(Date.now()/1000) + ':R>', inline: true },
        )
        .setFooter({ text: 'RCRP Live Map  •  Refreshes every 2 minutes' })
        .setTimestamp();

      const send = async () => {
        if (imgBuffer) {
          const att = new AttachmentBuilder(imgBuffer, { name: 'criminal-map.png' });
          embed.setImage('attachment://criminal-map.png');
          return ch.send({ embeds: [embed], files: [att] });
        }
        return ch.send({ embeds: [embed] });
      };

      const edit = async (msg) => {
        if (imgBuffer) {
          const att = new AttachmentBuilder(imgBuffer, { name: 'criminal-map.png' });
          embed.setImage('attachment://criminal-map.png');
          return msg.edit({ embeds: [embed], files: [att] });
        }
        return msg.edit({ embeds: [embed] });
      };

      // Always edit, never spam — one message forever
      if (mapMsgId) {
        const existing = await ch.messages.fetch(mapMsgId).catch(() => null);
        if (existing) {
          await edit(existing).catch(() => { mapMsgId = null; });
          if (mapMsgId) return;
        }
      }
      const sent = await send().catch(() => null);
      if (sent) mapMsgId = sent.id;

    } catch (err) {
      console.error('[MapPinner] pulse error:', err.message);
    }
  }

  async function findExistingMessage(client) {
    _client = client;
    try {
      const ch = client.channels.cache.get(config.channels.mapChannel);
      if (!ch) return;
      const msgs  = await ch.messages.fetch({ limit: 20 });
      const found = [...msgs.values()].find(m =>
        m.author.id === client.user.id &&
        m.embeds?.[0]?.title?.includes('Criminal Map')
      );
      if (found) { mapMsgId = found.id; console.log('[MapPinner] Latched onto existing map message:', found.id); }
    } catch {}
  }

  module.exports = { pulse, findExistingMessage };
  