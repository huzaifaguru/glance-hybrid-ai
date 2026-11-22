// Renders one description card with its routing trace. Shared by the side panel and the web demo.
const BADGE = { device: 'On device', cloud: 'Cloud', cache: 'Shared cache', blocked: 'Kept private' };

export function renderEntry({ thumb, res, onAsk, onReport }) {
  const li = document.createElement('li');
  li.className = 'entry';

  const head = document.createElement('div');
  head.className = 'entry-head';
  if (thumb) {
    const im = document.createElement('img');
    im.src = thumb;
    im.alt = '';
    im.className = 'thumb';
    head.appendChild(im);
  }
  const body = document.createElement('div');
  const badge = document.createElement('span');
  badge.className = `badge ${res.source}`;
  badge.textContent = BADGE[res.source] || res.source;
  const alt = document.createElement('p');
  alt.className = 'alt';
  alt.textContent = res.alt;
  body.append(badge, alt);
  if (res.detail) {
    const d = document.createElement('p');
    d.className = 'detail';
    d.textContent = res.detail;
    body.appendChild(d);
  }
  head.appendChild(body);
  li.appendChild(head);

  const trace = document.createElement('details');
  trace.className = 'trace';
  const sum = document.createElement('summary');
  sum.textContent = 'Why it was routed this way';
  trace.appendChild(sum);
  const ol = document.createElement('ol');
  for (const s of res.steps || []) {
    const it = document.createElement('li');
    it.className = s.source ? `src-${s.source}` : '';
    it.textContent = `${s.label}${s.ms != null ? ` (${s.ms} ms)` : ''}: ${s.detail || ''}`;
    ol.appendChild(it);
  }
  trace.appendChild(ol);
  li.appendChild(trace);

  if (onAsk) {
    const form = document.createElement('form');
    form.className = 'ask';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask about this image…';
    input.setAttribute('aria-label', `Ask a question about: ${res.alt}`);
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Ask';
    const answer = document.createElement('p');
    answer.className = 'answer';
    answer.setAttribute('aria-live', 'polite');
    form.append(input, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      btn.disabled = true;
      answer.textContent = 'Thinking…';
      try {
        const a = await onAsk(input.value.trim());
        answer.textContent = `${a.text}${a.source ? ` (${BADGE[a.source] || a.source})` : ''}`;
      } catch (err) {
        answer.textContent = `Could not answer: ${err.message}`;
      } finally { btn.disabled = false; }
    });
    li.append(form, answer);
  }
  if (onReport && res.source !== 'blocked') {
    const r = document.createElement('button');
    r.className = 'link';
    r.textContent = 'Report wrong description';
    r.addEventListener('click', async () => { await onReport(); r.textContent = 'Thanks, reported'; r.disabled = true; });
    li.appendChild(r);
  }
  return li;
}
