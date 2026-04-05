// ai.js — AI Utilities (NVIDIA NIM / OpenAI compatible)
const OpenAI = require('openai');
const config = require('../config');

let _client = null;
function getClient() {
  if (!_client && process.env.AI_API_KEY) {
    _client = new OpenAI({ apiKey: process.env.AI_API_KEY, baseURL: config.aiBaseUrl });
  }
  return _client;
}

async function chat(system, user, maxTokens = 600) {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.chat.completions.create({
      model: config.aiModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature: 0.65,
    });
    return r.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('[AI] chat error:', err.message);
    return null;
  }
}

async function generateDispatch(callText, players) {
  const staff = players.filter(p => p._permission && !['None', 'Normal'].includes(p._permission)).length;
  const sys = `You are a professional dispatch AI for the River City Role Play ERLC server. ${players.length} players online, ${staff} staff on duty. Give a short, tactical dispatch recommendation in 2–3 sentences. Be direct and action-oriented.`;
  return (await chat(sys, callText, 200)) || 'Handle according to standard protocol.';
}

async function analyzeApplication(category, answers, questions) {
  const text = questions.map((q, i) => `Q${i+1}: ${q.label}\nA: ${answers[q.id] || 'No answer'}`).join('\n\n');
  const sys = `You are an HR analyst for River City Role Play. Analyze this ${category} staff application. Note any red flags (copy-paste, vague/low-effort answers) or genuine strengths. Give a final recommendation: APPROVE, DENY, or REVIEW. Be concise and professional. Max 250 words.`;
  return (await chat(sys, text, 400)) || 'AI analysis unavailable. Please review manually.';
}

// answerQuestion — used by the mention handler.
// serverContext = string of all indexed channel content with [Source: #channel] markers
// userHistory = string summary of user's game data
async function answerQuestion(question, serverContext, userHistory, displayName) {
  const sys = `You are RCRP Management, the official AI assistant for the River City Role Play Discord server. You know everything about this server because you have indexed every channel.

You answer questions using the server knowledge below. When you cite a rule or fact, mention the source channel in brackets like [Source: #rules-channel]. Be direct, friendly, and human-sounding. If something isn't covered in the knowledge base, say so honestly.

=== SERVER KNOWLEDGE ===
${serverContext.slice(0, 6000)}

=== ASKING USER: ${displayName} ===
${userHistory ? `Game history:\n${userHistory}` : 'No game history available.'}`;

  const result = await chat(sys, question, 600);
  return result || "I don't have enough information to answer that right now. Try asking a staff member!";
}

module.exports = { chat, generateDispatch, analyzeApplication, answerQuestion };
