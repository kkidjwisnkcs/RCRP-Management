// ai.js — AI Utilities (NVIDIA NIM / OpenAI compatible)
'use strict';

const OpenAI = require('openai');
const config = require('../config');

let _client = null;
function getClient() {
  if (!_client && process.env.AI_API_KEY) {
    _client = new OpenAI({ apiKey: process.env.AI_API_KEY, baseURL: config.aiBaseUrl });
  }
  return _client;
}

async function chat(system, user, maxTokens = 700) {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.chat.completions.create({
      model:       config.aiModel,
      messages:    [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens:  maxTokens,
      temperature: 0.72,
    });
    return r.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('[AI] chat error:', err.message);
    return null;
  }
}

async function generateDispatch(callText, players) {
  const staff = players.filter(p => p._permission && !['None', 'Normal'].includes(p._permission)).length;
  const sys   = `You are a professional dispatch AI for the Florida State Roleplay ERLC server. ${players.length} players online, ${staff} staff on duty. Give a short, tactical dispatch recommendation in 2–3 sentences. Be direct and action-oriented.`;
  return (await chat(sys, callText, 200)) || 'Handle according to standard protocol.';
}

async function analyzeApplication(category, answers, questions) {
  const text = questions.map((q, i) => `Q${i + 1}: ${q.label}\nA: ${answers[q.id] || 'No answer'}`).join('\n\n');
  const sys  = `You are an HR analyst for Florida State Roleplay. Analyze this ${category} staff application. Call out red flags (copy-paste, vague/low-effort answers, contradictions) or genuine strengths. Final recommendation: APPROVE, DENY, or REVIEW. Be concise, professional. Max 250 words.`;
  return (await chat(sys, text, 450)) || 'AI analysis unavailable. Please review manually.';
}

async function internalAsk(query, dataContext) {
  const sys = `You are an internal affairs AI for the Florida State Roleplay management team. You have raw game log data to analyze. Answer the query clearly and professionally. Highlight notable patterns, rule violations, or concerns. Be factual and precise.

=== GAME DATA ===
${dataContext.slice(0, 8000)}`;
  return (await chat(sys, query, 1000)) || 'Unable to analyze the provided data.';
}

// ── postProcessSources ────────────────────────────────────────────────────────
// Strips any stray inline "[Source: #channel]" or "(Source: ...)" from the AI
// response body and consolidates them into a single "📚 #channel" line at the end.
function postProcessSources(text) {
  if (!text) return text;
  const sourceRefs = [];

  const cleaned = text
    .replace(/\[Source:\s*#?([\w-]+)(?:[^\]]*)\]/gi, (_, ch) => {
      const ref = `#${ch}`;
      if (!sourceRefs.includes(ref)) sourceRefs.push(ref);
      return '';
    })
    .replace(/\(Source:\s*#?([\w-]+)([^)]*)\)/gi, (_, ch) => {
      const ref = `#${ch}`;
      if (!sourceRefs.includes(ref)) sourceRefs.push(ref);
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If AI already put a 📚 line, leave it alone
  if (/📚/.test(cleaned)) return cleaned;

  // Append consolidated sources at bottom if any were stripped
  if (sourceRefs.length) return `${cleaned}\n\n📚 ${sourceRefs.join(' · ')}`;
  return cleaned;
}

// ── answerQuestion ────────────────────────────────────────────────────────────
// serverContext = indexed channel text (rules, announcements, etc.)
// memberContext = rich member data from server brain (roles, activity, facts)
// userHistory   = asking user's game/verify data string
// displayName   = asking user's display name
async function answerQuestion(question, serverContext, memberContext, userHistory, displayName) {
  const sys = `You are FSRP Management — the official AI for Florida State Roleplay. You scan the entire server every 2 minutes and have full knowledge of every rule, member, announcement, and channel going back years.

CRITICAL — HOW TO ANSWER:
• If the SERVER KNOWLEDGE below contains the answer — STATE IT DIRECTLY AND CONFIDENTLY. Never say "check the channel" or "I suggest looking at #..." when you already have that channel's content right here.
• Rules questions (RDM, VDM, FailRP, NLR, etc.) — give the actual rule. Be direct: "No, RDM is not allowed. Random Death Match means..." NOT "You might want to check #rules."
• If you can see the relevant channel content — you DO have the information. Use it.
• Only say you don't know if the server knowledge genuinely contains nothing relevant.

Personality:
• Sound like a knowledgeable, confident staff member — not a search engine
• Direct and specific — lead with the actual answer, not a hedge
• Use bullet points for lists, short paragraphs for explanations
• No fluff, no padding

Formatting (STRICT):
• NEVER write "[Source: #channel]" or "(Source:...)" inside your answer
• NEVER start sentences with "According to #channel-name"
• At the very END of your response (and ONLY there), add one line:
  \`📚 #channel-name\`  or  \`📚 #channel-one · #channel-two\`
• Nothing after the 📚 line — it is always the last thing
• Never make things up — if context is truly silent on something, say so briefly

=== SERVER KNOWLEDGE (live scan) ===
${serverContext.slice(0, 5000)}

=== MEMBER PROFILES ===
${memberContext ? memberContext.slice(0, 2500) : 'Member data loading — try again in a moment.'}

=== PERSON ASKING: ${displayName} ===
${userHistory || 'No game history on file for this user.'}`;

  const raw    = await chat(sys, question, 950);
  const result = raw || "I don't have enough info on that right now. Ping a staff member if it's urgent!";
  return postProcessSources(result);
}

module.exports = { chat, generateDispatch, analyzeApplication, answerQuestion, internalAsk, postProcessSources };
