// config.js — RCRP Management Bot Configuration

  module.exports = {
    heartbeatInterval: 20_000,
    snapshotInterval:  120_000,
    dbScanInterval:    60_000,

    aiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    aiModel:   'meta/llama-3.3-70b-instruct',

    colors: {
      primary: 0x2B2D31,
      neutral: 0x3D4045,
      success: 0x2D7D46,
      danger:  0x992D22,
      warning: 0xC37D00,
      gold:    0x8B7536,
      blue:    0x1D6FA5,
      red:     0xED4245,
      purple:  0x9B59B6,
    },

    channels: {
      gameDatabase:         '1488136483041710221',
      discordDatabase:      '1488136399084458065',
      verifyDatabase:       '1488136027704004689',
      staffApplications:    '1487990797679857734',
      hrCentral:            '1488138175057498142',
      ticketResults:        '1488279812039774259',
      logs:                 '1427862063681900637',
      mdt:                  '1488603761520807966',
      staffChat:            '1488332986867777606',
      staffPromotion:       '1488279812039774259',
      staffReview:          '1487893136687759421',
      verification:         '1488275213379567636',
      announcements:        '1487917734665912390',
      sessionAnnouncements: '1488537466783797420',
      inGameReports:        '1488200620350378154',
      selfRoles:            '1488603443760332904',
      shiftCards:           '1488548099055030313',
      discordRules:         '1487889324434522152',
      gameRules:            '1487889453027426489',
      leoRules:             '1487889559327998073',
      fdRules:              '1487889719189700849',
      dotRules:             '1487889806477492406',
      policeCodes:          '1488387226025857044',
      // ─── New feature channels ────────────────────────────
      // Set these to the real channel IDs in your server
      // wantedWall: live wanted-criminals board (any visible channel)
      // crimeTicker: auto news-feed of kills/events
      // mapChannel: where the ERLC criminal map gets posted every 2min
      // vouchBoard: where /vouch shoutouts get posted
      wantedWall:   '1488603761520807966',   // ← currently using MDT; change if you have a dedicated channel
      crimeTicker:  '1488603761520807966',   // ← same
      mapChannel:   '1488603761520807966',   // ← same
      vouchBoard:    '1488603443760332904',  // ← self-roles channel for now
        scenarioBoard: '1488332986867777606',  // ← staff chat for now; create a #scenario-board channel and update
      cityReport:   '1488332986867777606',   // ← staff chat for daily city report
    },

    roles: {
      owner:            '1419691048468349109',
      coOwner:          '1488159864692674824',
      ownershipAssist:  '1488159949635850240',
      ownershipTeam:    '1488160033941491772',
      serverDirector:   '1488194100586090566',
      deputyDirector:   '1488194152641593354',
      directiveAdvisor: '1488194203010728097',
      assistDirector:   '1488194263618424852',
      communityHandler: '1488195210919018536',
      hr:               '1488195280422568127',
      seniorManager:    '1488195585252004106',
      manager:          '1488195652671377498',
      trialManagement:  '1488195724343644271',
      staffSupervisor:  '1488195819545825512',
      staffTrainer:     '1488195889699881085',
      headAdmin:        '1488196031337463878',
      seniorAdmin:      '1488196434045177946',
      gameStaff:        '1488196516475834448',
      trialStaff:       '1488196587313172590',
      headModerator:    '1488197200172548250',
      seniorMod:        '1488197391445131435',
      moderator:        '1488197450618507344',
      trialMod:         '1488197512144879687',
      gameStaffGeneric: '1488502230498934935',
      discordStaff:     '1488502325852242031',
      discordAdmin:     '1488502325852242031',
      discordMod:       '1488327504824631338',
      trialDiscordMod:  '1488327697879928842',
      verified:         '1420056125813952523',
      unverified:       '1420031201112096769',
      leo:              '1488726480320987348',
      fireDept:         '1488726384011378729',
      dot:              '1488726582985232475',
      civilian:         '1488726710483685417',
      ssuPing:          '1488726213592748073',
      sessionPing:      '1488273501147103433',
      giveawayPing:     '1424766065128378388',
      mediaPing:        '1424766193356767334',
      onDutyStaff:      '1488139167698260059',
      played1Hour:      '1488139307901522170',
      played2Hour:      '1488139407360921661',
      staffLOA:         '1488198945405534320',
      staffOfWeek:      '1488207883970810030',
      applicationReviewer: '1488138755947626730',
      iaDirector:       '1488192871239520327',
      formerStaff:      '',
      strike1:          '',
      strike2:          '',
      strike3:          '',
      mediaTeam:        '1488138471444058202',
      leadMedia:        '1488135751983038557',
      srMedia:          '1488136071370768385',
      jrMedia:          '1488138660678471750',
      contentCreator:   '1488191434128490497',
      announcementPing: '1488273501147103433',
      seniorHighRank:   '1488496578590150736',
      highRank:         '1488496646198267995',
    },

    get staffRoles() {
      return [
        this.roles.owner, this.roles.coOwner, this.roles.ownershipTeam, this.roles.ownershipAssist,
        this.roles.serverDirector, this.roles.deputyDirector, this.roles.directiveAdvisor, this.roles.assistDirector,
        this.roles.communityHandler, this.roles.hr, this.roles.seniorManager, this.roles.manager, this.roles.trialManagement,
        this.roles.staffSupervisor, this.roles.staffTrainer,
        this.roles.headAdmin, this.roles.seniorAdmin, this.roles.gameStaff, this.roles.trialStaff,
        this.roles.headModerator, this.roles.seniorMod, this.roles.moderator, this.roles.trialMod,
        this.roles.gameStaffGeneric,
        this.roles.discordStaff, this.roles.discordMod, this.roles.trialDiscordMod,
      ].filter(Boolean);
    },

    get managementRoles() {
      return [
        this.roles.owner, this.roles.coOwner, this.roles.ownershipTeam, this.roles.ownershipAssist,
        this.roles.serverDirector, this.roles.deputyDirector, this.roles.directiveAdvisor, this.roles.assistDirector,
        this.roles.communityHandler, this.roles.hr,
      ].filter(Boolean);
    },

    get hrRoles() {
      return [
        this.roles.owner, this.roles.coOwner,
        this.roles.serverDirector, this.roles.deputyDirector,
        this.roles.hr, this.roles.communityHandler,
      ].filter(Boolean);
    },

    // ERLC River City coordinate bounds (game world studs)
    // Used by mapPinner to convert LocationX/LocationZ → image pixels
    mapCoords: {
      minX: -3500,
      maxX:  3500,
      minZ: -3500,
      maxZ:  3500,
    },

    // URL of the ERLC River City top-down map image
    // Replace with a direct PNG link to your preferred map image
    // The bot will download, cache, and overlay red dots on it
    // Set this to a direct PNG/JPG link to your ERLC River City map image.
    // Leave empty (\'\') to auto-generate a clean schematic map (works without any external URL).
    mapImageUrl: '',

    // MDT emergency call ping map — keyed by ERLC team string
    mdtPings: {
      'Police':  ['1488726480320987348'],
      'Fire':    ['1488726384011378729'],
      'EMS':     ['1488726384011378729'],
      'DOT':     ['1488726582985232475'],
      'Sheriff': ['1488726480320987348'],
      'SWAT':    ['1488726480320987348', '1488726213592748073'],
    },

    approvalRoles: {
      gamestaff: 'trialStaff',
      mod:       'trialDiscordMod',
      media:     'mediaTeam',
      whitelist: 'verified',
    },

    applicationCategories: [
      { id: 'gamestaff', label: 'Game Staff Team',    emoji: '🎮', description: 'Moderate and manage in-game as part of the Game Staff Team.' },
      { id: 'mod',       label: 'Discord Moderator',  emoji: '🛡️', description: 'Moderate the River City Role Play Discord server.' },
      { id: 'media',     label: 'Media Team',         emoji: '📸', description: 'Create content, clips, and graphics for RCRP.' },
      { id: 'whitelist', label: 'Server Whitelist',   emoji: '✅', description: 'Apply for whitelist access to River City Role Play private servers.' },
    ],

    applicationQuestions: {
      gamestaff: [
        { id: 'q1',  label: 'Tell us about yourself and your experience in Roblox roleplay.' },
        { id: 'q2',  label: 'Why do you want to join the Game Staff Team at RCRP?' },
        { id: 'q3',  label: 'What does "Game Staff Team" mean to you? How is it different from Discord moderation?' },
        { id: 'q4',  label: 'How many hours per week can you commit to being in-game and on duty?' },
        { id: 'q5',  label: 'Describe a situation where you handled a difficult player or conflict.' },
        { id: 'q6',  label: 'A player is mass RDMing. Walk us through your step-by-step response.' },
        { id: 'q7',  label: 'Another staff member is abusing their commands. How do you handle it?' },
        { id: 'q8',  label: 'What is the most important quality of a game staff member?' },
        { id: 'q9',  label: 'Do you have experience with ERLC? What commands do you know?' },
        { id: 'q10', label: 'A player files a false report against you. How do you respond?' },
        { id: 'q11', label: 'How do you handle burnout or stress from moderating?' },
        { id: 'q12', label: 'What would you do if you saw a supervisor breaking the rules?' },
        { id: 'q13', label: 'What sets you apart from other applicants?' },
        { id: 'q14', label: 'Do you have any questions for us?' },
        { id: 'q15', label: 'Type "I AGREE" to confirm all your answers are honest and your own.' },
      ],
      mod: [
        { id: 'q1',  label: 'Tell us about yourself and your Discord moderation experience.' },
        { id: 'q2',  label: 'Why do you want to be a Discord Moderator for RCRP?' },
        { id: 'q3',  label: 'How is Discord moderation different from game moderation?' },
        { id: 'q4',  label: 'How many hours per week can you actively be on Discord?' },
        { id: 'q5',  label: 'A member posts slurs in general chat. What do you do?' },
        { id: 'q6',  label: 'Two members are having a heated argument. How do you de-escalate?' },
        { id: 'q7',  label: 'You suspect a user is ban-evading. How do you confirm and respond?' },
        { id: 'q8',  label: 'Another moderator is misusing their power. What steps do you take?' },
        { id: 'q9',  label: 'How do you handle a false report filed against you?' },
        { id: 'q10', label: 'A member DMs you asking to reverse their ban. How do you respond?' },
        { id: 'q11', label: 'What is the biggest challenge in Discord moderation?' },
        { id: 'q12', label: 'How would you handle a raid or mass-join attack?' },
        { id: 'q13', label: 'What previous moderation or leadership roles have you held?' },
        { id: 'q14', label: 'Any questions for the team?' },
        { id: 'q15', label: 'Type "I AGREE" to confirm all your answers are honest and your own.' },
      ],
      media: [
        { id: 'q1',  label: 'Tell us about yourself and your content creation experience.' },
        { id: 'q2',  label: 'Why do you want to join the RCRP Media Team?' },
        { id: 'q3',  label: 'What kind of content would you create for RCRP?' },
        { id: 'q4',  label: 'What software do you use to create and edit content?' },
        { id: 'q5',  label: 'How many hours per week can you dedicate to creating content?' },
        { id: 'q6',  label: 'Share a link to any previous work you have created (optional).' },
        { id: 'q7',  label: 'How do you handle criticism of your creative work?' },
        { id: 'q8',  label: 'What makes RCRP content unique compared to other RP servers?' },
        { id: 'q9',  label: 'How would you promote RCRP to grow the community?' },
        { id: 'q10', label: 'Describe your turnaround time for a 60-second clip from raw footage.' },
        { id: 'q11', label: 'What is your availability — days and hours you are most active?' },
        { id: 'q12', label: 'Have you worked on a media team before? Describe your role.' },
        { id: 'q13', label: 'What is your creative vision for the RCRP brand online?' },
        { id: 'q14', label: 'Any questions for the team?' },
        { id: 'q15', label: 'Type "I AGREE" to confirm all your answers are honest and your own.' },
      ],
      whitelist: [
        { id: 'q1',  label: 'What is your Roblox username and how long have you played ERLC?' },
        { id: 'q2',  label: 'How did you find out about River City Role Play?' },
        { id: 'q3',  label: 'What type of roleplay do you enjoy most in ERLC (LEO, Fire/EMS, civilian, criminal, etc.)?' },
        { id: 'q4',  label: 'Have you been whitelisted or staff in any other ERLC server? If so, which ones?' },
        { id: 'q5',  label: 'Why do you want to join River City Role Play specifically?' },
        { id: 'q6',  label: 'Describe what realistic roleplay means to you and how you apply it.' },
        { id: 'q7',  label: 'A fellow player breaks a major RP rule. What do you do?' },
        { id: 'q8',  label: 'How do you handle situations where roleplay becomes heated or personal?' },
        { id: 'q9',  label: 'What is FailRP and can you give an example of it?' },
        { id: 'q10', label: 'How often are you able to be active in the RCRP server each week?' },
        { id: 'q11', label: 'Have you ever been banned from an ERLC server? Be honest — explain if so.' },
        { id: 'q12', label: 'What do you bring to the River City Role Play community?' },
        { id: 'q13', label: 'Describe a memorable roleplay scenario you have been a part of.' },
        { id: 'q14', label: 'Do you have any questions for the RCRP team?' },
        { id: 'q15', label: 'Type "I AGREE" to confirm all your answers are truthful and your own.' },
      ],
    },
  };
  