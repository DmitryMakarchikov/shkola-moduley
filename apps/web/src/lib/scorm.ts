/* пакет модуля для автономной работы: index.html (теория, словарь, практика, тест для самопроверки с проверкой в браузере)
   и imsmanifest.xml (SCORM 1.2) — открывается без интернета или загружается в СДО (Moodle, ресурс eior.by и др.) */
import type { Block, Lab, Lecture, Module, Question, Test } from '@pc/core';
import type { Client } from '../api/index.ts';
import { zip, type ZipFile } from './zip.ts';

export interface ModuleFull extends Module {
  course: { id: string; title: string };
  lectures: Lecture[];
  tests: Test[];
  labs: Lab[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (s: string) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
const paras = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${rich(p).replace(/\n/g, '<br>')}</p>`).join('\n');

/* безопасное имя файла пакета */
export const packageName = (no: number, title: string) => `Модуль ${no} — ${title}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

type Asset = { name: string; data: Uint8Array<ArrayBuffer> };

/* рисунки и файлы модуля попадают в пакет; не загрузился — остаётся подпись */
const collector = (client: Client) => {
  const assets: Asset[] = [];
  const done = new Map<string, string | null>();
  const fetchBytes = async (url: string) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(String(r.status));
    return new Uint8Array(await r.arrayBuffer());
  };
  const add = async (key: string, url: () => Promise<string>, ext: string) => {
    if (done.has(key)) return done.get(key)!;
    try {
      const name = `files/${String(assets.length + 1).padStart(3, '0')}.${ext}`;
      assets.push({ name, data: await fetchBytes(await url()) });
      done.set(key, name);
      return name;
    } catch {
      done.set(key, null);
      return null;
    }
  };
  const extOf = (s: string, def: string) => (s.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)?.[1] ?? def).toLowerCase();
  return {
    assets,
    image: (b: { src?: string; fileId: string }) =>
      b.src ? add(`src:${b.src}`, async () => b.src!, extOf(b.src, 'png')) : b.fileId ? add(`file:${b.fileId}`, () => client.fileUrl(b.fileId), 'png') : Promise.resolve(null),
    file: (id: string, caption: string) => add(`file:${id}`, () => client.fileUrl(id), extOf(caption, 'bin')),
  };
};

const blocksHtml = async (blocks: Block[], c: ReturnType<typeof collector>) => {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`<h3>${esc(b.text)}</h3>`);
        break;
      case 'text':
        out.push(paras(b.text));
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${b.items.map((x) => `<li>${rich(x)}</li>`).join('')}</${tag}>`);
        break;
      }
      case 'note':
        out.push(`<aside class="note note--${b.tone}">${rich(b.text)}</aside>`);
        break;
      case 'code':
        out.push(`<pre><code>${esc(b.text)}</code></pre>`);
        break;
      case 'table':
        out.push(
          `<div class="tw"><table><thead><tr>${(b.rows[0] ?? []).map((x) => `<th>${rich(x)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .slice(1)
            .map((r) => `<tr>${r.map((x) => `<td>${rich(x)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></div>`,
        );
        break;
      case 'image': {
        const src = await c.image(b);
        if (!src) {
          out.push(`<p class="muted">[Рисунок: ${esc(b.caption)}]</p>`);
          break;
        }
        /* точки-подсказки в пакете: номера поверх рисунка и пояснения под ним */
        const pts = b.points ?? [];
        const dots = pts.map((p, k) => `<span class="dot" style="left:${p.x}%;top:${p.y}%">${k + 1}</span>`).join('');
        const legend = pts.length ? `<ol class="pts">${pts.map((p) => `<li><strong>${esc(p.title)}</strong>${p.text ? ` — ${rich(p.text)}` : ''}</li>`).join('')}</ol>` : '';
        out.push(`<figure><span class="fig"><img src="${src}" alt="${esc(b.caption || 'Иллюстрация')}" loading="lazy">${dots}</span>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>${legend}`);
        break;
      }
      case 'video':
        out.push(`<p class="video">Видео: <a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.caption || b.url)}</a> (нужен интернет)</p>`);
        break;
      case 'file': {
        const href = b.fileId ? await c.file(b.fileId, b.caption) : null;
        out.push(href ? `<p><a href="${href}" download>${esc(b.caption || 'Файл')}</a></p>` : `<p class="muted">[Файл: ${esc(b.caption)}]</p>`);
        break;
      }
      case 'term':
        out.push(`<dl class="term"><dt>${esc(b.term)}</dt><dd>${rich(b.definition)}</dd></dl>`);
        break;
      case 'crossword':
        out.push(
          `<section class="cw"><h4>Кроссворд${b.title ? `: ${esc(b.title)}` : ''}</h4><ol>${b.words
            .map((w) => `<li>${w.n}, ${w.dir === 'across' ? 'по горизонтали' : 'по вертикали'} (${w.answer.length} букв): ${esc(w.clue)}</li>`)
            .join('')}</ol><p class="muted">Интерактивный кроссворд — на платформе «Школа модулей».</p></section>`,
        );
        break;
    }
  }
  return out.join('\n');
};

/* задания для проверки в браузере: ключи нужны странице, поэтому в пакет идут только тесты для самопроверки */
const quizData = async (tests: Test[], c: ReturnType<typeof collector>) => {
  const out = [];
  for (const t of tests) {
    const qs = [];
    for (const q of t.questions.filter((x: Question) => x.type !== 'diagram' && x.text.trim())) {
      qs.push({
        id: q.id,
        type: q.type,
        text: q.text,
        options: q.options,
        pairs: q.pairs,
        answer: q.answer,
        explain: q.explain,
        image: q.image ? await c.image({ src: q.image, fileId: '' }) : null,
      });
    }
    if (qs.length) out.push({ id: t.id, title: t.title, pass: t.settings.passPercent, questions: qs });
  }
  return out;
};

const STYLE = `
:root{--t:#131a2b;--m:#586377;--p:#1f4fd1;--ps:#e7edfd;--b:#dde3ee;--bg:#f4f6fb;--ok:#137547;--oks:#e1f3e9;--er:#bf2f2a;--ers:#fce7e6;--w:#955600;--ws:#fcf0da}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--t);font:17px/1.6 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif}
header.top{background:linear-gradient(135deg,#3a72ff,#6d3cf0);color:#fff;padding:28px 20px 22px}
header.top .in,main,nav.toc .in{max-width:880px;margin:0 auto}
header.top small{opacity:.85;letter-spacing:.06em;text-transform:uppercase;font-size:.78rem}
header.top h1{margin:6px 0 4px;font-size:1.9rem;line-height:1.2}
nav.toc{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--b)}
nav.toc .in{display:flex;flex-wrap:wrap;gap:4px;padding:8px 20px}
nav.toc a{padding:6px 10px;border-radius:8px;color:var(--t);text-decoration:none;font-size:.92rem}nav.toc a:hover{background:var(--ps);color:var(--p)}
main{padding:8px 20px 60px}
section.card{background:#fff;border:1px solid var(--b);border-radius:14px;padding:22px 24px;margin:18px 0}
h2{margin:0 0 12px;font-size:1.4rem}h3{margin:22px 0 8px;font-size:1.15rem}
.fig{position:relative;display:inline-block;max-width:100%}.dot{position:absolute;transform:translate(-50%,-50%);width:24px;height:24px;border:2px solid #fff;border-radius:50%;background:var(--p);color:#fff;font:700 12px/20px sans-serif;text-align:center}
.pts{margin:6px 0 16px;font-size:.95rem}
.muted{color:var(--m)}figure{margin:16px 0;text-align:center}figure img{max-width:100%;height:auto;border:1px solid var(--b);border-radius:8px}
figcaption{color:var(--m);font-size:.9rem;margin-top:6px}
pre{background:#0f1526;color:#e3eaf6;padding:14px;border-radius:10px;overflow:auto;font:14px/1.5 Consolas,monospace}
.tw{overflow:auto}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:.95rem}th,td{border:1px solid var(--b);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--bg)}
.note{border:1px solid var(--b);border-left:4px solid var(--p);background:var(--ps);border-radius:10px;padding:10px 14px;margin:12px 0}
.note--warn{border-left-color:var(--w);background:var(--ws)}.note--ok{border-left-color:var(--ok);background:var(--oks)}
dl.term{margin:12px 0;padding:10px 14px;border:1px solid var(--b);border-radius:10px}dl.term dt{font-weight:700}dl.term dd{margin:4px 0 0}
.gl dt{font-weight:700;margin-top:10px}.gl dd{margin:2px 0 0}
.q{border:1px solid var(--b);border-radius:12px;padding:14px 16px;margin:14px 0}.q h4{margin:0 0 8px;font-size:1rem}
.q label{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:8px;cursor:pointer}.q label:hover{background:var(--bg)}
.q input[type=text]{width:100%;padding:8px 10px;border:1px solid var(--b);border-radius:8px;font:inherit}
.q select{font:inherit;padding:4px 6px;border:1px solid var(--b);border-radius:6px;max-width:100%}
.q .row{display:flex;gap:8px;align-items:center;margin:4px 0}.q .row button{font:inherit;padding:2px 8px;border:1px solid var(--b);background:#fff;border-radius:6px;cursor:pointer}
.q.is-ok{border-color:var(--ok);background:var(--oks)}.q.is-bad{border-color:var(--er);background:var(--ers)}
.q .why{margin:8px 0 0;font-size:.95rem}
.btn{display:inline-block;padding:10px 18px;border:0;border-radius:10px;background:var(--p);color:#fff;font:600 1rem inherit;cursor:pointer}.btn--ghost{background:#fff;color:var(--p);border:1px solid var(--p)}
.res{font-size:1.15rem;font-weight:700;margin:12px 0}
footer.bottom{max-width:880px;margin:0 auto;padding:0 20px 40px;color:var(--m);font-size:.85rem}
@media print{nav.toc,.btn{display:none}section.card{break-inside:avoid-page;border:0;padding:0}}
`;

const SCRIPT = `
(function(){
var data=JSON.parse(document.getElementById('quiz-data').textContent);
var api=null;
function find(w){var n=0;while(w&&!w.API&&w.parent&&w.parent!==w&&n<10){w=w.parent;n++}return w&&w.API?w.API:null}
try{api=find(window)||(window.opener&&find(window.opener))}catch(e){api=null}
if(api){try{api.LMSInitialize('');var st=api.LMSGetValue('cmi.core.lesson_status');if(!st||st==='not attempted')api.LMSSetValue('cmi.core.lesson_status','incomplete');api.LMSCommit('')}catch(e){}}
window.addEventListener('beforeunload',function(){if(api){try{api.LMSFinish('')}catch(e){}}});
function el(t,a,c){var e=document.createElement(t);if(a)for(var k in a)e.setAttribute(k,a[k]);if(c!==undefined)e.textContent=c;return e}
function mix(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t}return a}
function norm(s){return String(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim()}
var total={score:0,max:0};
data.forEach(function(t,ti){
  var box=document.getElementById('quiz-'+ti);var form=el('form');
  var getters=[];
  t.questions.forEach(function(q,qi){
    var d=el('div',{'class':'q'});d.appendChild(el('h4',null,(qi+1)+'. '+q.text));
    if(q.image){var im=el('img',{src:q.image,alt:'Рисунок к заданию'});im.style.maxWidth='100%';d.appendChild(im)}
    var get;
    if(q.type==='single'||q.type==='multi'){
      var name='q'+ti+'_'+qi;
      q.options.forEach(function(o,i){var l=el('label');var inp=el('input',{type:q.type==='single'?'radio':'checkbox',name:name,value:i});l.appendChild(inp);l.appendChild(el('span',null,o));d.appendChild(l)});
      get=function(){var v=[].slice.call(d.querySelectorAll('input:checked')).map(function(x){return +x.value});return q.type==='single'?(v.length?v[0]:null):v};
    }else if(q.type==='short'){
      var inp=el('input',{type:'text','aria-label':'Ответ'});d.appendChild(inp);get=function(){return inp.value};
    }else if(q.type==='order'){
      var list=el('div');var cur=mix(q.options);
      var draw=function(){list.innerHTML='';cur.forEach(function(o,i){var r=el('div',{'class':'row'});var up=el('button',{type:'button','aria-label':'Выше'},'↑');var dn=el('button',{type:'button','aria-label':'Ниже'},'↓');up.onclick=function(){if(i>0){var t=cur[i-1];cur[i-1]=cur[i];cur[i]=t;draw()}};dn.onclick=function(){if(i<cur.length-1){var t=cur[i+1];cur[i+1]=cur[i];cur[i]=t;draw()}};r.appendChild(up);r.appendChild(dn);r.appendChild(el('span',null,(i+1)+'. '+o));list.appendChild(r)})};
      draw();d.appendChild(list);get=function(){return cur.slice()};
    }else if(q.type==='match'){
      var opts=mix(q.pairs);var sels=[];
      q.options.forEach(function(o){var r=el('div',{'class':'row'});r.appendChild(el('span',null,o+' —'));var s=el('select');s.appendChild(el('option',{value:''},'выберите'));opts.forEach(function(p){s.appendChild(el('option',{value:p},p))});sels.push(s);r.appendChild(s);d.appendChild(r)});
      get=function(){return sels.map(function(s){return s.value})};
    }
    var why=el('p',{'class':'why'});why.hidden=true;d.appendChild(why);
    getters.push({q:q,get:get,box:d,why:why});form.appendChild(d);
  });
  var res=el('p',{'class':'res'});var btn=el('button',{type:'submit','class':'btn'},'Проверить');var again=el('button',{type:'button','class':'btn btn--ghost'},'Пройти ещё раз');again.hidden=true;
  again.onclick=function(){location.hash='';location.reload()};
  form.appendChild(btn);form.appendChild(document.createTextNode(' '));form.appendChild(again);form.appendChild(res);
  form.onsubmit=function(e){e.preventDefault();var ok=0;
    getters.forEach(function(g){var a=g.get();var q=g.q;var right=false;
      if(q.type==='single')right=a===+q.answer[0];
      else if(q.type==='multi'){var k=q.answer.map(Number);right=a.length===k.length&&a.every(function(x){return k.indexOf(x)>=0})}
      else if(q.type==='short')right=q.answer.some(function(x){return norm(x)===norm(a)});
      else if(q.type==='order')right=a.every(function(x,i){return x===q.options[i]});
      else if(q.type==='match')right=a.every(function(x,i){return x===q.pairs[i]});
      if(right)ok++;g.box.className='q '+(right?'is-ok':'is-bad');
      var key=q.type==='single'?q.options[+q.answer[0]]:q.type==='multi'?q.answer.map(function(i){return q.options[+i]}).join('; '):q.type==='short'?q.answer.join(' / '):q.type==='order'?q.options.join(' → '):q.options.map(function(o,i){return o+' — '+q.pairs[i]}).join('; ');
      g.why.hidden=false;g.why.textContent=(right?'Верно. ':'Неверно. Правильный ответ: '+key+'. ')+(q.explain||'');
    });
    var pct=Math.round(ok/getters.length*100);res.textContent='Результат: '+ok+' из '+getters.length+' ('+pct+' %). '+(pct>=t.pass?'Тест сдан.':'Проходной результат — '+t.pass+' %: повторите теорию и пройдите ещё раз.');
    btn.hidden=true;again.hidden=false;
    total.score+=ok;total.max+=getters.length;
    if(api){try{var p=Math.round(total.score/total.max*100);api.LMSSetValue('cmi.core.score.min','0');api.LMSSetValue('cmi.core.score.max','100');api.LMSSetValue('cmi.core.score.raw',String(p));api.LMSSetValue('cmi.core.lesson_status',p>=t.pass?'passed':'failed');api.LMSCommit('')}catch(e){}}
  };
  box.appendChild(form);
});
})();
`;

export const buildModulePackage = async (client: Client, m: ModuleFull, no: number) => {
  const c = collector(client);
  const theory = [];
  for (const l of m.lectures) theory.push(`<h3 class="lt">${esc(l.title)}</h3>\n${await blocksHtml(l.blocks, c)}`);
  const terms = m.lectures.flatMap((l) => l.blocks).filter((b): b is Extract<Block, { type: 'term' }> => b.type === 'term');
  const uniq = terms.filter((t, i) => terms.findIndex((x) => x.term === t.term) === i).sort((a, b) => a.term.localeCompare(b.term, 'ru'));
  const labs = [];
  for (const l of m.labs) {
    labs.push(
      `<h3>${esc(l.title)}</h3>${l.goal ? `<p><strong>Цель.</strong> ${rich(l.goal)}</p>` : ''}${l.description ? paras(l.description) : ''}${l.blocks?.length ? await blocksHtml(l.blocks, c) : ''}${
        l.criteria.length ? `<p><strong>Критерии оценки</strong></p><ul>${l.criteria.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''
      }${l.controlQuestions?.length ? `<p><strong>Контрольные вопросы</strong></p><ol>${l.controlQuestions.map((x) => `<li>${rich(x)}</li>`).join('')}</ol>` : ''}<p class="muted">Работа сдаётся преподавателю на платформе «Школа модулей».</p>`,
    );
  }
  const selfTests = m.tests.filter((t) => t.settings.mode === 'self' && !t.settings.draft);
  const quiz = await quizData(selfTests, c);
  const control = m.tests.filter((t) => t.settings.mode === 'control' && !t.settings.draft);
  const sections: [string, string, string][] = [];
  if (m.goal || m.tasks.length)
    sections.push(['goal', 'Цель и задачи', `${m.goal ? `<p>${rich(m.goal)}</p>` : ''}${m.tasks.length ? `<ul>${m.tasks.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}`]);
  if (m.outcomes.length) sections.push(['outcomes', 'Результаты обучения', `<ul>${m.outcomes.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>`]);
  if (theory.length) sections.push(['theory', 'Теория', theory.join('\n')]);
  if (uniq.length) sections.push(['terms', 'Словарь терминов', `<dl class="gl">${uniq.map((t) => `<dt>${esc(t.term)}</dt><dd>${rich(t.definition)}</dd>`).join('')}</dl>`]);
  if (labs.length) sections.push(['practice', 'Практика', labs.join('\n')]);
  if (quiz.length || control.length)
    sections.push([
      'check',
      'Проверь себя',
      `${quiz.map((t, i) => `<h3>${esc(t.title)}</h3><div id="quiz-${i}"></div>`).join('\n')}${control.length ? `<p class="muted">Контрольные тесты (${control.map((t) => `«${esc(t.title)}»`).join(', ')}) проходят на платформе.</p>` : ''}`,
    ]);
  const title = `Тема ${no}. ${m.title}`;
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top"><div class="in"><small>${esc(m.course.title)}</small><h1>${esc(title)}</h1><div>Учебных часов: ${m.hours}</div></div></header>
<nav class="toc" aria-label="Разделы модуля"><div class="in">${sections.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</div></nav>
<main>
${sections.map(([id, t, body]) => `<section class="card" id="${id}"><h2>${t}</h2>\n${body}\n</section>`).join('\n')}
</main>
<footer class="bottom">Пакет учебного модуля создан на платформе «Школа модулей» ${new Date().toLocaleDateString('ru-RU')}. Работает без интернета; в системе дистанционного обучения загружается как пакет SCORM 1.2.</footer>
<script type="application/json" id="quiz-data">${JSON.stringify(quiz).replace(/</g, '\\u003c')}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
  const pass = selfTests[0]?.settings.passPercent ?? 60;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="shkola-moduley-${m.id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>${esc(title)}</title>
      <item identifier="item" identifierref="res" isvisible="true">
        <title>${esc(title)}</title>
        <adlcp:masteryscore>${pass}</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
${c.assets.map((a) => `      <file href="${a.name}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>`;
  const files: ZipFile[] = [{ name: 'index.html', data: html }, { name: 'imsmanifest.xml', data: manifest }, ...c.assets];
  return { blob: zip(files), name: `${packageName(no, m.title)}.zip`, images: c.assets.length, questions: quiz.reduce((s, t) => s + t.questions.length, 0) };
};
