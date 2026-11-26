const $ = (s, r = document) => r.querySelector(s), ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const root = document.documentElement;
let size = +ls.get('size') || 100, mode = ls.get('mode') || '';
const apply = () => { root.style.fontSize = size + '%'; root.dataset.mode = mode; const m = $('#mode'); if (m) m.value = mode; };
apply();
$('#fm').onclick = () => { size = Math.max(85, size - 10); ls.set('size', size); apply(); };
$('#fp').onclick = () => { size = Math.min(160, size + 10); ls.set('size', size); apply(); };
$('#mode').onchange = e => { mode = e.target.value; ls.set('mode', mode); apply(); };
// Реакции — только локально, в браузере
const likes = JSON.parse(ls.get('likes') || '{}');
const paint = b => { const on = !!likes[b.dataset.id]; b.setAttribute('aria-pressed', on); $('b', b).textContent = on ? 1 : 0; };
document.querySelectorAll('.like').forEach(b => { paint(b); b.onclick = () => { likes[b.dataset.id] ? delete likes[b.dataset.id] : (likes[b.dataset.id] = 1); ls.set('likes', JSON.stringify(likes)); document.querySelectorAll(`.like[data-id="${b.dataset.id}"]`).forEach(paint); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
