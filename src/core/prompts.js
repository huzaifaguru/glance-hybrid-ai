import { LANGUAGES } from './defaults.js';

const ROLE = 'You write image descriptions for blind and low-vision people who use screen readers. Be accurate and specific. Never guess the identity of real people. Never invent text you cannot read.';

function ctx({ title, context }) {
  const t = String(title || '').slice(0, 120);
  const c = String(context || '').slice(0, 400);
  return `Page title: "${t}".\nText near the image: "${c}".`;
}

export function quickPrompt({ title, context, lang = 'en' }) {
  return `${ROLE}
${ctx({ title, context })}
Look at the image. Reply with ONLY one JSON object and nothing else:
{"kind": "photo" | "illustration" | "chart" | "diagram" | "map" | "screenshot" | "document" | "meme" | "logo" | "icon" | "other",
 "contains_text": true | false,
 "alt": "alt text in ${LANGUAGES[lang] || 'English'}, at most 125 characters, most important thing first, do not start with 'image of'",
 "confidence": number between 0 and 1}`;
}

export function detailPrompt({ title, context, alt, kind, lang = 'en' }) {
  return `${ROLE}
${ctx({ title, context })}
Short alt text already written: "${alt}". Image kind: ${kind}.
Write a detailed description in ${LANGUAGES[lang] || 'English'}: at most 6 short sentences, plain text, no markdown, no lists.
- Chart or graph: say the title, what each axis shows, the overall trend, and the highest and lowest values with numbers.
- Screenshot, document or sign: transcribe the important visible text exactly, in quotes.
- Diagram or map: explain the parts and how they connect.
- Photo: describe actions, expressions, setting and notable details.`;
}

export function askPrompt({ title, context, alt, question, lang = 'en' }) {
  return `${ROLE}
${ctx({ title, context })}
Current description: "${alt}".
The user asks: "${String(question).slice(0, 300)}"
Answer in ${LANGUAGES[lang] || 'English'} in at most 3 short sentences, plain text. If the image does not show the answer, say so.`;
}
