import express from 'express';
import Parser from 'rss-parser';
import cron from 'node-cron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SITE = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DB = path.join(__dir, 'data', 'news.json');
const KEEP_DAYS = 14;

// Источники. Добавляй свои RSS сюда: {name, url, category: 'russia'|'world'}
const FEEDS = [
  { name: 'Lenta.ru', url: 'https://lenta.ru/rss/news', category: 'russia' },
  { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml', category: 'russia' },
  { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml', category: 'russia' },
  { name: 'BBC Русская служба', url: 'https://feeds.bbci.co.uk/russian/rss.xml', category: 'world' },
  { name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-ru-all', category: 'world' },
];
const CATS = { russia: 'Россия', world: 'Мир' };

const parser = new Parser({ timeout: 10000 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = d => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

let news = [];
const load = () => {
  try { news = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { news = []; }
  if (!news.length) news = JSON.parse(fs.readFileSync(path.join(__dir, 'data', 'seed.json'), 'utf8'));
};

async function refresh() {
  const fresh = [];
  await Promise.all(FEEDS.map(async f => {
    try {
      const r = await parser.parseURL(f.url);
      for (const it of r.items.slice(0, 40)) {
        if (!it.title || !it.link) continue;
        const date = new Date(it.isoDate || it.pubDate || Date.now());
        fresh.push({
          id: crypto.createHash('sha1').update(it.link).digest('hex').slice(0, 10),
          title: clean(it.title), summary: clean(it.contentSnippet || it.content || it.description).slice(0, 420),
          link: it.link, source: f.name, category: f.category, date: isNaN(date) ? new Date().toISOString() : date.toISOString(),
        });
      }
    } catch (e) { console.warn(`[feed] ${f.name}: ${e.message}`); }
  }));
  if (!fresh.length) return console.warn('[refresh] ни одна лента не ответила, оставляю старые данные');
  const map = new Map(news.filter(n => !n.id.startsWith('seed')).map(n => [n.id, n]));
  fresh.forEach(n => map.set(n.id, n));
  const limit = Date.now() - KEEP_DAYS * 864e5;
  news = [...map.values()].filter(n => +new Date(n.date) > limit).sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync(DB, JSON.stringify(news));
  console.log(`[refresh] ${news.length} новостей`);
}

// «Подборка дня»: меняется раз в сутки (по дате МСК), детерминированно для всех посетителей
function dailyPick(n = 8) {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
  let seed = [...day].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pool = news.filter(x => x.summary.length > 60);
  const a = (pool.length >= n ? pool : news).slice(0, 120);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const card = n => `<article class="card"><a href="/n/${n.id}"><span class="tag">${CATS[n.category]} · ${esc(n.source)}</span><h3>${esc(n.title)}</h3><p>${esc(n.summary.slice(0, 160))}${n.summary.length > 160 ? '…' : ''}</p></a><div class="row"><time datetime="${n.date}">${fmt(n.date)}</time><button class="like" data-id="${n.id}" aria-pressed="false" aria-label="Нравится">♥ <b>0</b></button></div></article>`;

function layout({ title, desc, path: p, body, ld, type = 'website' }) {
  const url = SITE + p;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="${type}"><meta property="og:url" content="${url}"><meta property="og:locale" content="ru_RU">
<meta name="theme-color" content="#14365d"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css">
<link rel="alternate" type="application/rss+xml" title="Ясно" href="/rss.xml">${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}</head>
<body><a class="skip" href="#main">К содержимому</a>
<header class="top"><a class="logo" href="/">Ясно<small>новости без рекламы</small></a>
<nav aria-label="Рубрики"><a href="/">Сегодня</a><a href="/rubric/russia">Россия</a><a href="/rubric/world">Мир</a></nav>
<div class="tools" role="group" aria-label="Настройки чтения"><button id="fm" aria-label="Уменьшить шрифт">А−</button><button id="fp" aria-label="Увеличить шрифт">А+</button>
<select id="mode" aria-label="Режим оформления"><option value="">Обычный</option><option value="senior">Для старших</option><option value="dark">Тёмный</option></select></div></header>
<main id="main">${body}</main>
<footer><p>«Ясно» — открытый проект без рекламы и трекеров. Мы собираем заголовки и краткие анонсы из открытых лент СМИ и всегда указываем источник; полный текст — на сайте источника.</p><p>Реакции хранятся только в вашем браузере.</p></footer>
<script src="/app.js" defer></script></body></html>`;
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dir, 'public'), { maxAge: '1h' }));

app.get('/', (req, res) => {
  const pick = dailyPick(), [lead, ...rest] = pick;
  const latest = news.slice(0, 24).filter(n => !pick.includes(n));
  res.send(layout({
    title: 'Ясно — новости без рекламы', desc: 'Главные новости России и мира без рекламы. Подборка дня обновляется каждые 24 часа, у каждой новости указан источник.', path: '/',
    body: `<section class="lead"><span class="tag">Подборка дня · ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })}</span>
<h1><a href="/n/${lead.id}">${esc(lead.title)}</a></h1><p>${esc(lead.summary)}</p></section>
<section class="grid" aria-label="Ещё в подборке">${rest.map(card).join('')}</section>
<h2>Свежее</h2><section class="grid">${latest.map(card).join('')}</section>`,
  }));
});

app.get('/rubric/:cat', (req, res) => {
  const c = req.params.cat;
  if (!CATS[c]) return res.status(404).send(layout({ title: 'Не найдено', desc: '', path: req.path, body: '<h1>Такой рубрики нет</h1><p><a href="/">На главную</a></p>' }));
  res.send(layout({ title: `${CATS[c]} — Ясно`, desc: `Новости рубрики «${CATS[c]}» без рекламы.`, path: `/rubric/${c}`,
    body: `<h1>${CATS[c]}</h1><section class="grid">${news.filter(n => n.category === c).slice(0, 60).map(card).join('')}</section>` }));
});

app.get('/n/:id', (req, res) => {
  const n = news.find(x => x.id === req.params.id);
  if (!n) return res.status(404).send(layout({ title: 'Не найдено', desc: '', path: req.path, body: '<h1>Новость не найдена</h1><p>Возможно, она устарела. <a href="/">На главную</a></p>' }));
  const more = news.filter(x => x.category === n.category && x.id !== n.id).slice(0, 4);
  res.send(layout({
    title: `${n.title} — Ясно`, desc: n.summary.slice(0, 200), path: `/n/${n.id}`, type: 'article',
    ld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: n.title.slice(0, 110), description: n.summary, datePublished: n.date, mainEntityOfPage: `${SITE}/n/${n.id}`, publisher: { '@type': 'Organization', name: 'Ясно' }, isBasedOn: n.link, author: { '@type': 'Organization', name: n.source } },
    body: `<article class="full"><span class="tag">${CATS[n.category]} · ${esc(n.source)}</span><h1>${esc(n.title)}</h1><time datetime="${n.date}">${fmt(n.date)}</time>
<p class="body">${esc(n.summary)}</p><p><a class="btn" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer nofollow">Читать полностью у источника: ${esc(n.source)}</a></p>
<div class="row"><button class="like" data-id="${n.id}" aria-pressed="false">♥ Нравится <b>0</b></button></div></article>
<h2>Ещё по теме</h2><section class="grid">${more.map(card).join('')}</section>`,
  }));
});

app.get('/api/news', (req, res) => res.json(news.slice(0, 100)));
app.get('/rss.xml', (req, res) => {
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Ясно</title><link>${SITE}</link><description>Новости без рекламы</description>${news.slice(0, 50).map(n => `<item><title>${esc(n.title)}</title><link>${SITE}/n/${n.id}</link><guid>${SITE}/n/${n.id}</guid><pubDate>${new Date(n.date).toUTCString()}</pubDate><description>${esc(n.summary)}</description></item>`).join('')}</channel></rss>`);
});
app.get('/sitemap.xml', (req, res) => {
  const u = (l, d) => `<url><loc>${SITE}${l}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`;
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u('/', new Date().toISOString())}${u('/rubric/russia')}${u('/rubric/world')}${news.map(n => u(`/n/${n.id}`, n.date)).join('')}</urlset>`);
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`));

load();
if (process.argv.includes('--refresh')) { await refresh(); process.exit(0); }
cron.schedule('*/30 * * * *', refresh); // новости каждые 30 минут; подборка дня меняется сама в полночь по МСК
app.listen(PORT, () => { console.log(`Ясно: ${SITE}`); if (!fs.existsSync(DB)) refresh(); });
