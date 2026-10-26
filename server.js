require('dotenv').config();
const express = require('express');
const cors = require('cors'); // 1. Import cors
const rateLimit = require('express-rate-limit');
const path = require('path');

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Missing GEMINI_API_KEY. Create a .env file (see .env.example).'); process.exit(1); }
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const LANG = { en:'English', zu:'isiZulu', xh:'isiXhosa', af:'Afrikaans', st:'Sesotho', tn:'Setswana', nso:'Sepedi', ts:'Xitsonga', ve:'Tshivenda', ss:'SiSwati', nr:'IsiNdebele' };

const BASE = `You are Kasi AI (Mzansi AI), a friendly kasi buddy who helps South African learners from Grade R to Grade 12 with the CAPS curriculum.
Tone: friendly, supportive, encouraging, light Gen Z + Mzansi slang (e.g. "Sharp!", "Eish", "No stress"), simple explanations suited to the learner's age.
Understand mixed languages (learners often mix English with isiZulu, isiXhosa, Afrikaans, Sesotho etc.). Reply in the language the learner writes in; if they mix, reply mainly in the language they use most, keeping key terms in English.
Always be respectful and child-safe. Refuse harmful or inappropriate requests kindly and steer back to learning.
If the learner is scared, stressed or sad, comfort them first, then give simple study tips.
Keep replies short (under 170 words). Never invent exact textbook page numbers; name the grade, subject and chapter/topic instead.`;

const GUIDE = BASE + `
CORE RULE: do NOT give the final answer. Instead: 1) break the problem down, 2) explain the concept simply with a real-life example, 3) guide step by step but only reveal ONE step at a time, 4) end with one question for the learner to think about, 5) say where to read more in their textbook (grade, subject, chapter), 6) encourage them to try it themselves. If the learner says "next hint" or similar, reveal only the next step.`;

const LUFFY = BASE + `
LUFFY MODE: the learner has asked for the answer. Solve the problem and give the final answer with the steps explained quickly. Do not add the warning message, the server adds it.`;

const LUFFY_WARNING = `Hey, you're in Luffy Mode now.

This means I'm giving you the answer instead of helping you learn step-by-step.

Before you write this answer down ask yourself:

Do you trust Luffy?

Because right now you're not using Kasi AI the learning way.`;

async function gemini(system, contents) {
  const r = await fetch(GEMINI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Gemini error', r.status, data.error && data.error.message); throw new Error('gemini'); }
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = parts ? parts.map(p => p.text || '').join('').trim() : '';
  if (!text) throw new Error('empty');
  return text;
}

const app = express();

// 2. Enable CORS so your Vercel frontend can talk to this Render backend
app.use(cors());

app.use(express.json({ limit: '12mb' }));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));

function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.slice(-12)
    .filter(m => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map(m => ({ role: m.role, parts: [{ text: m.text.slice(0, 2000) }] }));
}
const langHint = l => `\n(Learner's chosen language: ${LANG[l] || 'English'}.)`;

app.post('/api/chat', async (req, res) => {
  const { message, mode, lang, history } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 1000) return res.status(400).json({ error: 'bad message' });
  try {
    const luffy = mode === 'luffy';
    const contents = [...cleanHistory(history), { role: 'user', parts: [{ text: message.trim() }] }];
    const text = await gemini((luffy ? LUFFY : GUIDE) + langHint(lang), contents);
    res.json({ reply: luffy ? LUFFY_WARNING + '\n\n' + text : text });
  } catch (e) { res.status(502).json({ error: 'ai unavailable' }); }
});

app.post('/api/vision', async (req, res) => {
  const { image, mime, lang } = req.body || {};
  if (typeof image !== 'string' || !/^image\/(jpeg|png|webp)$/.test(mime || '')) return res.status(400).json({ error: 'bad image' });
  try {
    const contents = [{ role: 'user', parts: [
      { inlineData: { mimeType: mime, data: image } },
      { text: "This is a photo of the learner's homework. Say 'Sharp, let's break this down.' then identify what the question is about and guide them using the core rule. Do NOT give the final answer. Reveal only step 1 and ask one question." }
    ] }];
    res.json({ reply: await gemini(GUIDE + langHint(lang), contents) });
  } catch (e) { res.status(502).json({ error: 'ai unavailable' }); }
});

app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kasi AI running on http://localhost:${PORT}`));
