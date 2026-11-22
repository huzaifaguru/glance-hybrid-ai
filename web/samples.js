// Draws the sample-page images at runtime, so the repo ships no third-party image assets.
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function rainfallChart() {
  const [c, g] = canvas(560, 320);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 560, 320);
  g.fillStyle = '#111'; g.font = 'bold 18px sans-serif'; g.fillText('Monthly rainfall 2026 (mm)', 20, 30);
  const data = [['Jan', 42], ['Feb', 38], ['Mar', 61], ['Apr', 88], ['May', 97], ['Jun', 54]];
  const max = 100; const x0 = 60; const y0 = 280; const bw = 60;
  g.strokeStyle = '#444'; g.beginPath(); g.moveTo(x0, 50); g.lineTo(x0, y0); g.lineTo(540, y0); g.stroke();
  g.font = '12px sans-serif';
  for (let v = 0; v <= max; v += 25) { const y = y0 - (v / max) * 220; g.fillStyle = '#666'; g.fillText(String(v), 28, y + 4); }
  data.forEach(([m, v], i) => {
    const x = x0 + 20 + i * 78; const h = (v / max) * 220;
    g.fillStyle = v > 80 ? '#1a56db' : '#7aa2ff'; g.fillRect(x, y0 - h, bw, h);
    g.fillStyle = '#111'; g.fillText(m, x + 18, y0 + 18); g.fillText(String(v), x + 18, y0 - h - 6);
  });
  return c.toDataURL('image/png');
}

export function billingNotice() {
  const [c, g] = canvas(560, 300);
  g.fillStyle = '#fffdf5'; g.fillRect(0, 0, 560, 300);
  g.strokeStyle = '#b00020'; g.lineWidth = 4; g.strokeRect(10, 10, 540, 280);
  g.fillStyle = '#b00020'; g.font = 'bold 26px sans-serif'; g.fillText('NOTICE TO RESIDENTS', 120, 60);
  g.fillStyle = '#111'; g.font = '18px sans-serif';
  ['Water billing moves to monthly on July 1.', 'Average bill: $38 per month.', 'Payment due by the 15th of each month.', 'Questions? Call 555-0142 (Mon to Fri, 9 to 5).']
    .forEach((t, i) => g.fillText(t, 40, 110 + i * 40));
  return c.toDataURL('image/png');
}

export function parkScene() {
  const [c, g] = canvas(560, 320);
  const sky = g.createLinearGradient(0, 0, 0, 200); sky.addColorStop(0, '#8ec5ff'); sky.addColorStop(1, '#dff0ff');
  g.fillStyle = sky; g.fillRect(0, 0, 560, 320);
  g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(470, 60, 32, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3f9b4a'; g.fillRect(0, 200, 560, 120);
  g.fillStyle = '#4a90d9'; g.beginPath(); g.moveTo(0, 270); g.bezierCurveTo(180, 240, 360, 300, 560, 260); g.lineTo(560, 320); g.lineTo(0, 320); g.fill();
  for (const [x, s] of [[90, 1], [200, 0.8], [330, 1.1]]) {
    g.fillStyle = '#6b4423'; g.fillRect(x - 5 * s, 150, 10 * s, 60 * s);
    g.fillStyle = '#2e7d32'; g.beginPath(); g.arc(x, 140, 34 * s, 0, Math.PI * 2); g.fill();
  }
  for (const [x, col] of [[150, '#e53935'], [260, '#8e24aa'], [400, '#fb8c00']]) {
    g.fillStyle = '#f1c27d'; g.beginPath(); g.arc(x, 176, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.fillRect(x - 10, 186, 20, 30);
    g.strokeStyle = '#333'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 10, 195); g.lineTo(x + 26, 214); g.stroke();
  }
  return c.toDataURL('image/png');
}
