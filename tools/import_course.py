"""Импорт учебных материалов преподавателя в курс платформы «Школа модулей».

Вход — папка с материалами:
  Теоретический раздел/*.docx            лекции (номер в начале имени = номер занятия)
  Тесты/*.docx                           тесты (правильные ответы выделены курсивом, жирным или подсветкой)
  Самостоятельные работы/*.docx          самостоятельные работы и кроссворд
  ТРПО Метод_рек к Лаб_Р/*.docx          методические рекомендации к лабораторным работам
  Содержание/Содержание.xlsx             структура курса: разделы, темы, часы

Выход:
  packages/course-trpo/course.json       курс: разделы → модули → лекции, тесты, лабораторные
  apps/web/public/course/trpo/*.webp     рисунки (сжатые)

Запуск: python -P tools/import_course.py <папка_материалов>
"""
import hashlib
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

APP = Path(__file__).resolve().parent.parent
OUT_JSON = APP / 'packages' / 'course-trpo' / 'course.json'
OUT_IMG = APP / 'apps' / 'web' / 'public' / 'course' / 'trpo'
SRC_PREFIX = 'course/trpo/'

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
V = '{urn:schemas-microsoft-com:vml}'
PR = '{http://schemas.openxmlformats.org/package/2006/relationships}'

# упоминания конкретного учреждения в материалах не переносятся
BANNED = re.compile(r'Гродн|ГГКТТД|облисполком|колледж техники', re.I)


# ---------- чтение DOCX ----------
class Run:
    __slots__ = ('text', 'b', 'i', 'u', 'h', 'c', 's')

    def __init__(self, el):
        self.text = ''.join((t.text or '') for t in el.iter() if t.tag in (W + 't', W + 'tab')) if el is not None else ''
        if el is not None and any(t.tag == W + 'tab' for t in el.iter()):
            self.text = self.text or ' '
        rpr = el.find(W + 'rPr') if el is not None else None

        def flag(tag):
            if rpr is None:
                return False
            x = rpr.find(W + tag)
            return x is not None and x.get(W + 'val') not in ('0', 'false', 'none')

        self.b = flag('b')
        self.i = flag('i')
        self.u = flag('u')
        self.h = flag('highlight') or (rpr is not None and rpr.find(W + 'shd') is not None and (rpr.find(W + 'shd').get(W + 'fill') or 'auto').lower() not in ('auto', 'ffffff'))
        col = rpr.find(W + 'color') if rpr is not None else None
        self.c = col is not None and (col.get(W + 'val') or 'auto').lower() not in ('auto', '000000')
        self.s = flag('strike')


class Para:
    def __init__(self, el):
        ppr = el.find(W + 'pPr')
        self.style = ''
        self.align = ''
        self.num = False
        self.ilvl = 0
        if ppr is not None:
            st = ppr.find(W + 'pStyle')
            self.style = st.get(W + 'val') if st is not None else ''
            jc = ppr.find(W + 'jc')
            self.align = jc.get(W + 'val') if jc is not None else ''
            numpr = ppr.find(W + 'numPr')
            if numpr is not None:
                nid = numpr.find(W + 'numId')
                self.num = nid is None or nid.get(W + 'val') != '0'
                lvl = numpr.find(W + 'ilvl')
                self.ilvl = int(lvl.get(W + 'val')) if lvl is not None else 0
        self.runs = []
        self.images = []
        for node in el.iter():
            if node.tag == W + 'r':
                r = Run(node)
                if r.text:
                    self.runs.append(r)
            elif node.tag == A + 'blip':
                rid = node.get(R + 'embed')
                if rid:
                    self.images.append(rid)
            elif node.tag == V + 'imagedata':
                rid = node.get(R + 'id')
                if rid:
                    self.images.append(rid)

    @property
    def text(self):
        return re.sub(r'\s+', ' ', ''.join(r.text for r in self.runs)).strip()

    def share(self, attr):
        """Доля символов текста с данным выделением."""
        total = sum(len(r.text.strip()) for r in self.runs)
        if not total:
            return 0.0
        return sum(len(r.text.strip()) for r in self.runs if getattr(r, attr)) / total

    @property
    def bold(self):
        return self.share('b') > 0.85

    def rich(self):
        """Текст с **жирным** для выделенных частей (если выделена не вся строка)."""
        if self.bold:
            return self.text
        out = ''
        for r in self.runs:
            out += f'\x01{r.text}\x02' if r.b and r.text.strip() else r.text
        out = out.replace('\x02\x01', '')
        out = re.sub(r'\x01(\s*)', r'\1**', out)
        out = re.sub(r'(\s*)\x02', r'**\1', out)
        out = re.sub(r'\*\*\s*\*\*', '', out)
        return re.sub(r'\s+', ' ', out).strip()


class Table:
    def __init__(self, el):
        self.rows = []
        for tr in el.findall(W + 'tr'):
            row = []
            for tc in tr.findall(W + 'tc'):
                row.append([Para(p) for p in tc.iter(W + 'p')])
            self.rows.append(row)

    @property
    def images(self):
        return [rid for row in self.rows for cell in row for p in cell for rid in p.images]


class Docx:
    def __init__(self, path):
        self.path = Path(path)
        self.z = zipfile.ZipFile(path)
        root = ET.fromstring(self.z.read('word/document.xml'))
        self.body = root.find(W + 'body')
        self.rels = {}
        if 'word/_rels/document.xml.rels' in self.z.namelist():
            for rel in ET.fromstring(self.z.read('word/_rels/document.xml.rels')).findall(PR + 'Relationship'):
                self.rels[rel.get('Id')] = rel.get('Target')

    def items(self):
        for el in self.body:
            if el.tag == W + 'p':
                yield Para(el)
            elif el.tag == W + 'tbl':
                yield Table(el)

    def media(self, rid):
        target = self.rels.get(rid)
        if not target or target.startswith('http'):
            return None
        name = 'word/' + target.lstrip('/') if not target.startswith('word/') else target
        name = name.replace('word/../', '')
        try:
            return self.z.read(name), Path(name).suffix.lower()
        except KeyError:
            return None


# ---------- рисунки ----------
class Images:
    def __init__(self):
        OUT_IMG.mkdir(parents=True, exist_ok=True)
        for old in OUT_IMG.glob('*.webp'):
            old.unlink()
        self.by_hash = {}
        self.count = 0
        self.bytes = 0
        self.failed = 0

    def save(self, doc, rid, prefix):
        got = doc.media(rid)
        if not got:
            return None
        data, ext = got
        h = hashlib.sha1(data).hexdigest()
        if h in self.by_hash:
            return self.by_hash[h]
        try:
            im = Image.open(io.BytesIO(data))
            if ext in ('.emf', '.wmf'):
                try:
                    im.load(dpi=144)
                except TypeError:
                    im.load()
            im.seek(0)
            im.load()
        except Exception:
            self.failed += 1
            self.by_hash[h] = None
            return None
        if im.width < 40 or im.height < 40:
            self.by_hash[h] = None
            return None
        if im.mode in ('RGBA', 'LA', 'P'):
            im = im.convert('RGBA')
            bg = Image.new('RGB', im.size, 'white')
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert('RGB')
        im.thumbnail((960, 1400))
        self.count += 1
        name = f'{prefix}-{self.count:03d}.webp'
        im.save(OUT_IMG / name, 'WEBP', quality=76, method=6)
        self.bytes += (OUT_IMG / name).stat().st_size
        src = SRC_PREFIX + name
        self.by_hash[h] = src
        return src


IMAGES = None


# ---------- лекция → блоки ----------
def is_caption(t):
    return bool(re.match(r'^(Рис(унок|\.)?|Схема)\s*\d', t))


def heading_text(t):
    t = re.sub(r'^\d+(\.\d+)*[\.\)]?\s+', '', t).strip()
    return t.rstrip(':').strip()


def as_term(p):
    """«**Термин** – определение» → блок термина."""
    runs = [r for r in p.runs if r.text.strip()]
    if not runs or not runs[0].b or p.bold:
        return None
    head = ''
    for r in p.runs:
        if r.b or not r.text.strip():
            head += r.text
        else:
            break
    rest = p.text[len(re.sub(r'\s+', ' ', head).strip()):].strip()
    head = re.sub(r'\s+', ' ', head).strip().rstrip('–—-: ').strip()
    m = re.match(r'^(–|—|-|это\b|—\s*это\b)\s*', rest)
    if not m or not (2 <= len(head) <= 90) or len(rest) < 15:
        return None
    definition = rest[m.end():].strip()
    definition = definition[0].upper() + definition[1:] if definition else definition
    return {'type': 'term', 'term': head, 'definition': definition}


LIST_MARK = re.compile(r'^\s*([•·▪◦\-–—*]|\d{1,2}[\)]|[а-яa-z][\)])\s+')


def table_block(t):
    rows = []
    for row in t.rows:
        cells = [' '.join(p.text for p in cell if p.text).strip() for cell in row][:12]
        if any(cells):
            rows.append([c[:1000] for c in cells])
    if len(rows) < 1 or max(len(r) for r in rows) < 2:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [''] * (width - len(r)) for r in rows][:100]
    return {'type': 'table', 'rows': rows}


def to_blocks(items, prefix, title=None, plan_mode=True):
    """Абзацы и таблицы документа → блоки лекции."""
    blocks = []
    text_buf = []
    list_buf = []
    list_ordered = [False]
    state = {'plan': None, 'heading_no': 0, 'questions': False}

    def flush_text():
        if text_buf:
            blocks.append({'type': 'text', 'text': '\n\n'.join(text_buf)})
            text_buf.clear()

    def flush_list():
        if list_buf:
            blocks.append({'type': 'list', 'items': list_buf[:100], 'ordered': list_ordered[0] or state['questions']})
            list_buf.clear()

    def flush():
        flush_text()
        flush_list()

    items = list(items)
    skip = set()
    # заголовок документа: первые центрированные жирные строки до текста
    for k, it in enumerate(items[:4]):
        if isinstance(it, Para) and it.text and it.align == 'center' and it.bold and not re.match(r'^Цель', it.text):
            skip.add(k)
        elif isinstance(it, Para) and it.text:
            break

    seen_text = False
    for k, it in enumerate(items):
        if k in skip:
            continue
        if isinstance(it, Table):
            flush()
            tb = table_block(it)
            if tb:
                blocks.append(tb)
            for rid in it.images:
                src = IMAGES.save(DOC[0], rid, prefix)
                if src:
                    blocks.append({'type': 'image', 'fileId': '', 'src': src, 'caption': ''})
            continue
        p = it
        for rid in p.images:
            src = IMAGES.save(DOC[0], rid, prefix)
            if src:
                flush()
                blocks.append({'type': 'image', 'fileId': '', 'src': src, 'caption': ''})
        t = p.text
        if not t or BANNED.search(t):
            continue
        if is_caption(t):
            if blocks and blocks[-1]['type'] == 'image' and not blocks[-1]['caption']:
                blocks[-1]['caption'] = t
                continue
        if re.match(r'^Цель\s*[:.]', t):
            flush()
            blocks.append({'type': 'note', 'text': t, 'tone': 'info'})
            continue
        if re.match(r'^Контрольные вопросы', t, re.I) and len(t) < 60 and (seen_text or not plan_mode):
            flush()
            blocks.append({'type': 'heading', 'text': 'Контрольные вопросы'})
            state['questions'] = True
            continue
        numbered = p.num or bool(LIST_MARK.match(t))
        # «Вопросы:» / «План:» перед планом лекции — начало плана, а не текст
        if plan_mode and not seen_text and re.match(r'^(Вопросы|План)(\s+(лекции|занятия))?\s*:?$', t, re.I):
            flush()
            if state['plan'] is None:
                state['plan'] = []
            continue
        # план лекции: подряд идущие жирные пункты в начале
        if plan_mode and not seen_text and p.bold and numbered and len(t) < 160:
            if state['plan'] is None:
                flush()
                state['plan'] = []
            item = heading_text(LIST_MARK.sub('', t))
            if not re.match(r'^(Контрольные вопросы|Вопросы для самоконтроля)', item, re.I):
                state['plan'].append(item)
            continue
        # жирные нумерованные пункты сразу после фразы с двоеточием («Lean одержим идеей:») — список, а не заголовки
        if not numbered:
            state['colon_list'] = False
        elif p.bold and seen_text and (state.get('colon_list') or (text_buf and text_buf[-1].rstrip().endswith(':'))):
            flush_text()
            if not list_buf:
                list_ordered[0] = bool(re.match(r'^\s*\d', t))
            list_buf.append(LIST_MARK.sub('', p.rich()).strip()[:2000])
            state['colon_list'] = True
            continue
        # жирная строка-нотация «Имя (аргумент: тип)» — не заголовок
        if p.bold and len(t) <= 160 and not t.endswith((',', ';')) and not re.search(r'\(.*:.*\)', t):
            flush()
            state['questions'] = False
            h = heading_text(LIST_MARK.sub('', t))
            if not h or (title and h.lower() == title.lower()):
                continue
            if state['plan'] and h.lower().startswith(tuple(x.lower()[:25] for x in state['plan'])):
                state['heading_no'] += 1
                h = f"{state['heading_no']}. {h}"
            blocks.append({'type': 'heading', 'text': h[:200]})
            seen_text = True
            continue
        term = as_term(p)
        if term and not numbered:
            flush()
            blocks.append(term)
            seen_text = True
            continue
        if numbered:
            flush_text()
            if not list_buf:
                list_ordered[0] = bool(re.match(r'^\s*\d', t))
            list_buf.append(LIST_MARK.sub('', p.rich()).strip()[:2000])
            continue
        flush_list()
        seen_text = True
        x = p.rich()
        # номер раздела из Word в начале абзаца («**1.** Под моделью…») не нужен: разделы и так есть
        x = re.sub(r'^\*\*\d+\.\*\*\s*', '', x)
        if text_buf:
            prev = text_buf[-1]
            if prev.endswith('-') and re.match(r'^[а-яёa-z]', x):
                text_buf[-1] = prev[:-1] + x
                continue
            if not re.search(r'[.!?:;»)…]$', prev) and re.match(r'^[а-яёa-z]', x):
                text_buf[-1] = prev + ' ' + x
                continue
        text_buf.append(x)
    flush()
    # пустые заголовки в конце и подряд
    clean = []
    for b in blocks:
        if b['type'] == 'heading' and clean and clean[-1]['type'] == 'heading' and clean[-1]['text'] != 'План':
            clean[-1] = b
            continue
        clean.append(b)
    while clean and clean[-1]['type'] == 'heading':
        clean.pop()
    # маркеры из шрифта Symbol (U+F0xx) в браузере видны как квадратики — убираем
    sym = re.compile(r'[-]\s*')
    for b in clean:
        for k in ('text', 'term', 'definition', 'caption'):
            if isinstance(b.get(k), str):
                b[k] = sym.sub('', b[k]).strip()
        if b['type'] == 'list':
            b['items'] = [sym.sub('', x).strip() for x in b['items']]
        if b['type'] == 'table':
            b['rows'] = [[sym.sub('', c).strip() for c in row] for row in b['rows']]
    PLAN[0] = state['plan'] or []
    return clean


DOC = [None]
PLAN = [[]]


def lecture(path, prefix):
    DOC[0] = Docx(path)
    items = list(DOC[0].items())
    paras = [x for x in items if isinstance(x, Para) and x.text]
    goal = ''
    for p in paras[:8]:
        m = re.match(r'^Цель\s*[:.]\s*(.+)', p.text)
        if m:
            goal = m.group(1).strip()
            break
    title = re.sub(r'^\d+\s+', '', Path(path).stem).strip().rstrip('.').replace(' docx', '').strip()
    blocks = to_blocks(items, prefix, title=title)
    # цель показывается в шапке лекции, из блоков убирается
    blocks = [b for b in blocks if not (b['type'] == 'note' and re.match(r'^Цель\s*[:.]', b['text']))]
    return {'title': title, 'goal': goal, 'tasks': PLAN[0][:12], 'blocks': blocks}


# ---------- тесты ----------
OPT_MARK = re.compile(r'^\s*(?:[А-ГA-Fa-fа-д]|\d{1,2})\s*[\)\.]\s*(?=\S)|^\s*[•▪◦\-–]\s+')
LETTER = re.compile(r'^\s*([А-ГA-Fa-fа-д])\s*[\)\.]\s*(?=\S)')
FLAGS = ('i', 'b', 'h', 'u', 'c')
LETTERS = {}
for alphabet in ('АБВГДЕ', 'абвгде', 'ABCDEF', 'abcdef'):
    for i, ch in enumerate(alphabet):
        LETTERS[ch] = i


def option_flags(p):
    return {f for f in FLAGS if p.share(f) > 0.6}


def strip_q(t):
    return re.sub(r'^\s*\d{1,3}\s*[\.\)]?\s*', '', t).strip()


SKIP_LINE = re.compile(r'^(Вариант\s*\d+|Тест\b|Тестовое задание|Самостоятельная работа|Задание:?$|Выберите один|\(Отметьте|\(Ответ считается|Ответы?\b)', re.I)


def text_run(text, like=None):
    r = Run.__new__(Run)
    r.text = text
    for f in ('b', 'i', 'u', 'h', 'c', 's'):
        setattr(r, f, getattr(like, f) if like is not None else False)
    return r


def merge_continuations(paras):
    """Строка, перенесённая клавишей Enter («…компьютера и» + «человека:»), склеивается с предыдущей."""
    out = []
    for p in paras:
        prev = out[-1] if out else None
        if prev is not None and p.text and prev.text and re.match(r'^[а-яёa-z]', p.text) and len(p.text) < 30 \
                and not re.search(r'[.?!:;…)]\s*$', prev.text) and not OPT_MARK.match(p.text) and not p.images:
            words = p.text.split()
            if words and prev.text.split()[-1].lower() == words[0].strip(':?').lower():
                tail = p.text[len(words[0]):]
                if words[0].endswith((':', '?')):
                    tail = words[0][-1] + tail
                prev.runs.append(text_run(tail, p.runs[-1] if p.runs else None))
            else:
                prev.runs.append(text_run(' ' + p.text, p.runs[-1] if p.runs else None))
            continue
        out.append(p)
    return out


def split_questions(paras, mode):
    """Разбор на вопросы и варианты ответа одним из способов."""
    qs = []
    cur = None
    texts = [p.text for p in paras]
    for k, p in enumerate(paras):
        t = p.text
        if not t and not p.images:
            continue
        if t and SKIP_LINE.match(t):
            if re.match(r'^Вариант\s*\d+', t, re.I):
                cur = None
                qs.append('VARIANT')
            continue
        nxt = next((x for x in texts[k + 1:] if x), '')
        if mode == 'ilvl':
            is_opt = p.num and p.ilvl >= 1
        elif mode == 'letter':
            is_opt = bool(LETTER.match(t))
        elif mode == 'punct':
            is_q = bool(re.search(r'(\?|:|…|\.\s?\.\s?\.|\bэто)\s*$', t)) or bool(re.match(r'^\d{1,3}\s*[\.\)]\s*\S', t)) or nxt.lower().strip('. ') in ('да', 'нет')
            is_opt = not is_q
        else:
            is_opt = (p.num or bool(OPT_MARK.match(t))) and not (p.bold and t.endswith(('?', ':', '…', '...')))
            if re.match(r'^\s*\d{1,3}\s*[\.\)]?\s+\S', t) and not p.num and (p.bold or t.endswith(('?', ':', '…'))):
                is_opt = False
        if is_opt and cur is not None:
            cur['options'].append(p)
        elif not is_opt:
            if cur is not None and not cur['options'] and len(cur['text']) < 400:
                cur['text'] += ' ' + t
                cur['images'] += p.images
            else:
                cur = {'text': t, 'options': [], 'images': list(p.images)}
                qs.append(cur)
    return qs


def answer_key(items):
    """Ключ ответов в конце документа: «Ответы …: А / В / Б / А – 3 …»."""
    for it in items:
        cells = []
        if isinstance(it, Table):
            for row in it.rows:
                for cell in row:
                    cells += [p.text for p in cell if p.text]
        elif isinstance(it, Para) and re.match(r'^Ответы?\b', it.text):
            cells = re.split(r'[;,/]\s*|\s{2,}', it.text)
        if cells and re.match(r'^Ответы?\b', cells[0]):
            entries = [c.strip() for c in cells[1:] if c.strip()]
            if len(entries) >= 3:
                return entries
    return None


def build_test(path, prefix):
    DOC[0] = Docx(path)
    items = list(DOC[0].items())
    paras = merge_continuations([x for x in items if isinstance(x, Para) and (x.text or x.images)])
    key = answer_key(items)
    best = None
    for mode in ('ilvl', 'letter', 'list', 'punct'):
        raw = split_questions(paras, mode)
        cand = [q for q in raw if q != 'VARIANT' and 2 <= len(q['options']) <= 10]
        if not cand:
            continue
        score = {f: sum(1 for q in cand if 1 <= sum(f in option_flags(o) for o in q['options']) < len(q['options'])) for f in FLAGS}
        flag = max(score, key=score.get)
        ok = score[flag] * 10 + len(cand)
        if best is None or ok > best[0]:
            best = (ok, mode, flag, raw, score[flag], len(cand))
    if not best:
        return None, f'вопросы не найдены ({Path(path).name})'
    _, mode, flag, raw, marked, total = best
    use_key = key is not None and marked < 3
    draft = not use_key and marked < 3
    questions = []
    variants = []
    vno = 0
    ki = 0
    for q in raw:
        if q == 'VARIANT':
            vno += 1
            continue
        text = strip_q(q['text'])
        matching = bool(re.search(r'соотнес|соответстви', text, re.I))
        if use_key and matching:
            while ki < len(key) and re.search(r'\d', key[ki]):
                ki += 1
            continue
        if not (2 <= len(q['options']) <= 10) or matching:
            if use_key and q['options']:
                ki += 1
            continue
        opts = [OPT_MARK.sub('', o.text).strip().rstrip(';').strip()[:500] for o in q['options']]
        if any(not o for o in opts) or len(set(opts)) != len(opts):
            if use_key:
                ki += 1
            continue
        if use_key:
            entry = key[ki] if ki < len(key) else ''
            ki += 1
            answer = sorted({LETTERS[ch] for ch in re.findall(r'[А-ГA-Fa-fа-д]', entry) if LETTERS.get(ch, 99) < len(opts)})
        elif draft:
            answer = []
        else:
            answer = [i for i, o in enumerate(q['options']) if flag in option_flags(o)]
            if not (1 <= len(answer) < len(opts)):
                continue
        if not draft and not answer:
            continue
        img = None
        for rid in q['images']:
            img = IMAGES.save(DOC[0], rid, prefix)
            if img:
                break
        qq = {'id': f'q{len(questions) + 1}', 'type': 'single' if len(answer) <= 1 else 'multi', 'text': text[:2000], 'options': opts, 'pairs': [], 'answer': answer, 'explain': '', 'points': 1}
        if img:
            qq['image'] = img
        # варианты ссылаются друг на друга («правильные ответы b), d)», «все перечисленные») — порядок не меняется
        if any(re.search(r'(правильн|верн)\w*\s+(ответ|вариант)|все\s+(выше\s*)?(перечисленн|ответы)|ответа нет|\b[a-dа-г]\)\s*,', o, re.I) for o in opts):
            qq['fixed'] = True
        questions.append(qq)
        variants.append(vno)
    pick = 0
    if max(variants or [0]) >= 1:
        per = {}
        for v in variants:
            per[v] = per.get(v, 0) + 1
        pick = min(per.values())
    how = 'ключ ответов' if use_key else ('без отмеченных ответов — черновик' if draft else f'выделение «{flag}»')
    if len(questions) < 3:
        return None, f'слишком мало заданий ({Path(path).name})'
    return {'questions': questions, 'pick': pick, 'draft': draft}, f'{len(questions)} заданий, {how}, разбор «{mode}»'


# ---------- лабораторные из методички ----------
SECTIONS = [
    ('goal', r'Цель работы'),
    ('task', r'Задание'),
    ('equip', r'Оснащение работы'),
    ('theory', r'Основные теоретические сведения'),
    ('steps', r'Порядок выполнения работы'),
    ('report', r'Форма отч[её]та'),
    ('questions', r'Контрольные вопросы'),
    ('books', r'Рекомендуемая литература'),
]


def labs(path):
    DOC[0] = Docx(path)
    out = []
    cur = None
    sec = None
    for it in DOC[0].items():
        if isinstance(it, Para):
            t = it.text
            m = re.match(r'^Лабораторная работа\s*№\s*(\d+)\s*$', t)
            if m and it.style == '1':
                cur = {'n': int(m.group(1)), 'topic': '', 'parts': {k: [] for k, _ in SECTIONS}}
                out.append(cur)
                sec = None
                continue
            if cur is None:
                continue
            m = re.match(r'^Тема работы:\s*[«"]?(.+?)[»"]?\s*$', t)
            if m and not cur['topic']:
                cur['topic'] = m.group(1).strip()
                continue
            found = None
            if it.share('b') > 0.5 and len(t) < 60:
                for key, pat in SECTIONS:
                    if re.match(r'^(\d\s*\.?\s*)?' + pat, t, re.I):
                        found = key
            if found:
                sec = found
                continue
        if cur is not None and sec:
            cur['parts'][sec].append(it)
    result = []
    for lab in out:
        n = lab['n']
        parts = lab['parts']
        plain = lambda key: ' '.join(p.text for p in parts[key] if isinstance(p, Para) and p.text and not BANNED.search(p.text))
        # варианты: строки «Вариант N …» и таблицы вариантов
        variants = []
        for key in ('task', 'steps'):
            keep = []
            for it in parts[key]:
                if isinstance(it, Para):
                    m = re.match(r'^Вариант\s*(\d+)\s*[\.:)\-–—]?\s*(.+)', it.text)
                    if m and len(m.group(2)) > 3:
                        variants.append(m.group(2).strip()[:1000])
                        continue
                if isinstance(it, Table) and it.rows and re.search('вариант', ' '.join(p.text for p in it.rows[0][0]), re.I):
                    for row in it.rows[1:]:
                        cells = [' '.join(p.text for p in c).strip() for c in row]
                        txt = ' — '.join(c for c in cells[1:] if c)
                        if txt:
                            variants.append(txt[:1000])
                    continue
                keep.append(it)
            parts[key] = keep
        prefix = f'lab{n:02d}'
        blocks = []
        task_blocks = to_blocks(parts['task'], prefix, plan_mode=False)
        if task_blocks:
            blocks += [{'type': 'heading', 'text': 'Задание'}] + task_blocks
        if parts['equip']:
            blocks.append({'type': 'note', 'text': 'Оснащение: ' + plain('equip'), 'tone': 'info'})
        theory = to_blocks(parts['theory'], prefix, plan_mode=False)
        if theory:
            blocks += [{'type': 'heading', 'text': 'Теоретические сведения'}] + theory
        steps = to_blocks(parts['steps'], prefix, plan_mode=False)
        if steps:
            blocks += [{'type': 'heading', 'text': 'Порядок выполнения'}] + steps
        report = [p.text.strip('_ ') for p in parts['report'] if isinstance(p, Para) and p.text.strip('_ ')]
        if report:
            blocks += [{'type': 'heading', 'text': 'Форма отчёта'}, {'type': 'list', 'items': [r.rstrip(':_ ') for r in report][:30], 'ordered': False}]
        books = [p.text for p in parts['books'] if isinstance(p, Para) and p.text and not BANNED.search(p.text)]
        if books:
            blocks += [{'type': 'heading', 'text': 'Рекомендуемая литература'}, {'type': 'list', 'items': books[:20], 'ordered': True}]
        questions = [LIST_MARK.sub('', p.text).strip() for p in parts['questions'] if isinstance(p, Para) and p.text]
        result.append({
            'n': n,
            'title': f'Лабораторная работа № {n}. {lab["topic"][:1].upper() + lab["topic"][1:]}',
            'goal': plain('goal')[:2000],
            'description': plain('task')[:20000],
            'blocks': blocks,
            'questions': questions[:30],
            'variants': variants[:60],
            'criteria': ['все пункты порядка выполнения выполнены', 'отчёт оформлен по форме', 'даны ответы на контрольные вопросы'],
        })
    return result


# ---------- структура курса ----------
def read_xlsx(path):
    NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    z = zipfile.ZipFile(path)
    shared = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = []
    for row in root.iter('{%s}row' % NS['m']):
        vals = {}
        for c in row.findall('m:c', NS):
            v = c.find('m:v', NS)
            val = shared[int(v.text)] if c.get('t') == 's' and v is not None else (v.text if v is not None else '')
            vals[re.sub(r'\d', '', c.get('r'))] = re.sub(r'\s+', ' ', val or '').strip()
        rows.append(vals)
    return rows


def structure(path):
    sections = [{'title': 'Введение в дисциплину', 'lessons': []}]
    last = 0
    for r in read_xlsx(path)[4:]:
        a, b, c = r.get('A', ''), r.get('B', ''), r.get('C', '')
        if not b:
            continue
        if b.startswith('Раздел'):
            sections.append({'title': b, 'lessons': []})
            continue
        if b.startswith('Обязательная контрольная работа'):
            no = re.search(r'\d+', b).group(0)
            sections[-1]['lessons'].append({'n': None, 'okr': int(no), 'title': f'Обязательная контрольная работа № {no}', 'hours': int(float(c or 1))})
            continue
        if re.match(r'^\d+\.\d+', b):
            continue
        n = int(a) if a.isdigit() else last + 1
        last = n
        title = re.sub(r'^Анализ ОКР\s*№\s*\d+\.\s*', '', b).strip()
        title = re.sub(r'\.(?=[А-ЯA-Z])', '. ', title).rstrip('.').strip()
        title = re.sub(r'\.\(', ' (', title)
        sections[-1]['lessons'].append({'n': n, 'title': title, 'hours': int(float(c)) if c.replace('.', '').isdigit() else 2})
    return sections


# привязка лабораторных и тестов к занятиям
LAB_LESSON = {1: 2, 2: 5, 3: 5, 4: 9, 5: 10, 6: 11, 7: 11, 8: 11, 9: 11, 10: 13, 11: 14, 12: 14, 13: 20, 14: 21, 15: 22, 16: 23,
              17: 24, 18: 24, 19: 24, 20: 25, 21: 26, 22: 25, 23: 26, 24: 26, 25: 26, 26: 27, 27: 28, 28: 28, 29: 28, 30: 29, 31: 29, 32: 29}
DIAGRAM_LAB = {13: 'usecase', 16: 'class'}
TESTS = [
    # (файл или список файлов-вариантов, занятие, название, режим)
    ('Тест по 1 разделу Жизненный цикл программного обеспечения .docx', 5, 'Итоговый тест по разделу I', 'self'),
    ('Тест по теме Методология  IDEF0.docx', 10, 'Тест: методология IDEF0', 'self'),
    ('Тест по теме Моделирование бизнес-процессов.docx', 11, 'Тест: моделирование бизнес-процессов', 'self'),
    ('Тест Объектный подход к разработке программного обеспечения.docx', 16, 'Тест: объектный подход', 'self'),
    ('Тест по теме Принципы ООП.docx', 17, 'Тест: принципы ООП', 'self'),
    ('Тесты по 1 и 2 разделам.docx', 'okr1', 'Контрольная работа: разделы I–II', 'control'),
    ('Тест по UML (1).docx', 19, 'Тест: язык UML', 'self'),
    ('Тест по UML (2).docx', 19, 'Тест: элементы UML', 'self'),
    (['Диаграммы UML В1.docx', 'Диаграммы UML В2.docx', 'Диаграммы UML В3.docx', 'Диаграммы UML В4.docx'], 24, 'Самостоятельная работа: диаграммы UML', 'self'),
    ('Самостоятельная работа Диаграмма состояний.docx', 22, 'Самостоятельная работа: диаграмма состояний', 'self'),
    ('Тест по теме Пользовательский интерфейс.docx', 26, 'Тест: пользовательский интерфейс', 'self'),
    ('Тест по шаблонам проектирования.docx', 27, 'Тест: шаблоны проектирования', 'self'),
    ('Тест по теме Процесс верификации и сопровождения.Качество ПО.docx', 'okr2', 'Контрольная работа: верификация и качество ПО', 'control'),
    (['вариант 1.docx', 'вариант 2.docx'], 36, 'Тест: гибкие методологии', 'self'),
    ('Тест по теме Манифест гибкой разработки ПО. Agile-подход.docx', 36, 'Тест: манифест Agile', 'self'),
    ('Тест по теме Методологии Agile.docx', 37, 'Тест: методологии Agile', 'self'),
    ('Тест по теме SCRUM.docx', 37, 'Тест: Scrum', 'self'),
]

CROSSWORD = {
    'type': 'crossword',
    'title': 'Жизненный цикл программного обеспечения',
    'words': [
        {'n': 1, 'dir': 'down', 'row': 0, 'col': 10, 'answer': 'ВЕРИФИКАЦИЯ', 'clue': 'Определение того, что программные продукты, являющиеся результатами некоторого действия, полностью удовлетворяют требованиям или условиям, обусловленным предшествующими действиями'},
        {'n': 2, 'dir': 'across', 'row': 1, 'col': 7, 'answer': 'МОДЕЛЬ', 'clue': 'Структура, определяющая последовательность выполнения и взаимосвязи процессов, действий и задач на протяжении жизненного цикла'},
        {'n': 3, 'dir': 'down', 'row': 2, 'col': 4, 'answer': 'ЭКСПЛУАТАЦИЯ', 'clue': 'Действия и задачи оператора — организации, эксплуатирующей систему'},
        {'n': 4, 'dir': 'down', 'row': 4, 'col': 6, 'answer': 'ДОКУМЕНТИРОВАНИЕ', 'clue': 'Формализованное описание информации, созданной в течение жизненного цикла информационной системы'},
        {'n': 5, 'dir': 'down', 'row': 4, 'col': 12, 'answer': 'СОПРОВОЖДЕНИЕ', 'clue': 'Внесение изменений в программное обеспечение в целях исправления ошибок, повышения производительности или адаптации к изменившимся условиям работы или требованиям'},
        {'n': 6, 'dir': 'across', 'row': 5, 'col': 4, 'answer': 'ПРОЕКТИРОВАНИЕ', 'clue': 'Деятельность человека или организации по созданию прототипа, прообраза предполагаемого или возможного объекта, состояния'},
        {'n': 7, 'dir': 'across', 'row': 7, 'col': 9, 'answer': 'РАЗРАБОТКА', 'clue': 'Все работы по созданию информационного программного обеспечения и его компонентов в соответствии с заданными требованиями'},
        {'n': 8, 'dir': 'down', 'row': 7, 'col': 17, 'answer': 'КОНЦЕПЦИЯ', 'clue': 'Комплекс взглядов, связанных между собой и вытекающих один из другого, система путей решения выбранной задачи. Определяет стратегию действий'},
        {'n': 9, 'dir': 'across', 'row': 10, 'col': 0, 'answer': 'КАСКАДНАЯ', 'clue': '… модель предусматривает последовательное выполнение всех этапов проекта в строго фиксированном порядке. Переход на следующий этап означает полное завершение работ на предыдущем этапе'},
        {'n': 10, 'dir': 'across', 'row': 13, 'col': 8, 'answer': 'ПРОЦЕСС', 'clue': 'Определяется как совокупность взаимосвязанных действий, преобразующих входные данные в выходные'},
        {'n': 10, 'dir': 'down', 'row': 13, 'col': 8, 'answer': 'ПЕРИОД', 'clue': '… времени, который начинается с момента принятия решения о необходимости создания информационной системы и заканчивается в момент её полного изъятия из эксплуатации'},
        {'n': 11, 'dir': 'across', 'row': 16, 'col': 4, 'answer': 'СТАДИЯ', 'clue': 'Часть процесса создания информационной системы, ограниченная определёнными временными рамками и заканчивающаяся выпуском конкретного продукта (моделей, программных компонентов, документации)'},
    ],
}


def check_crossword(cw):
    grid = {}
    for w in cw['words']:
        for i, ch in enumerate(w['answer']):
            r, c = (w['row'] + i, w['col']) if w['dir'] == 'down' else (w['row'], w['col'] + i)
            assert grid.get((r, c), ch) == ch, f'кроссворд: конфликт в клетке {r},{c} слова {w["answer"]}'
            grid[(r, c)] = ch
    return len(grid)


SELF_STUDY_LABS = [
    # открытые вопросы: учащийся отвечает текстом или файлом
    ('Самостоятельная работа по теме Моделирование данных .docx', 13, 'Самостоятельная работа: моделирование данных'),
    ('Самостоятельная работа по теме Диаграммы вариантов использования и диаграммы взаимодействия.docx', 20, 'Самостоятельная работа: варианты использования и взаимодействие'),
    ('Самостоятельная работа по теме Диаграмма классов, деятельности, последовательности.docx', 23, 'Самостоятельная работа: классы, деятельность, последовательность'),
]


def self_study(path, prefix):
    DOC[0] = Docx(path)
    items = [x for x in DOC[0].items() if not (isinstance(x, Para) and re.match(r'^Самостоятельная работа', x.text or ''))]
    variants = []
    # «Моделирование данных»: варианты повторяются блоками — оставляем уникальные
    texts = [x.text for x in items if isinstance(x, Para)]
    if any(re.search(r'\d\s*вариант', t) for t in texts):
        DOC[0] = Docx(path)
        cur = None
        for p in DOC[0].items():
            if not isinstance(p, Para) or not p.text:
                continue
            m = re.search(r'(\d)\s*вариант', p.text)
            if m:
                cur = int(m.group(1))
                continue
            if cur and len(variants) < cur:
                variants.append([])
            if cur and len(variants[cur - 1]) < 12 and p.text not in variants[cur - 1]:
                variants[cur - 1].append(p.text)
        variants = ['; '.join(v) for v in variants if v]
        return {'blocks': [{'type': 'note', 'text': 'Ответьте письменно на вопросы своего варианта (вариант выдаётся автоматически) и отправьте ответы в комментарии или файлом.', 'tone': 'info'}], 'variants': variants}
    blocks = to_blocks(items, prefix, plan_mode=False)
    blocks.insert(0, {'type': 'note', 'text': 'Ответьте на вопросы письменно: в комментарии к сдаче или файлом с ответами.', 'tone': 'info'})
    return {'blocks': blocks, 'variants': []}


KEYS_FILE = Path(__file__).with_name('answer_keys.json')
KEYS = json.loads(KEYS_FILE.read_text('utf-8')) if KEYS_FILE.exists() else {}


def apply_key(title, bank):
    """Ключ ответов для теста без отмеченных ответов: исключения, правки текста, ответы.
    Возвращает (задания, черновик?) или (задания, None), если ключа нет."""
    k = KEYS.get(title)
    if not k:
        return bank, None
    out = []
    for n, q in enumerate(bank, 1):
        if n in k.get('drop', []):
            continue
        if str(n) in k.get('text', {}):
            q['text'] = k['text'][str(n)]
        if str(n) in k.get('options', {}):
            q['options'] = q['options'][: k['options'][str(n)]]
        letters = k.get('answers', {}).get(str(n))
        if letters:
            idx = [ord(ch) - ord('a') for ch in letters]
            assert all(0 <= i < len(q['options']) for i in idx), (title, n, letters)
            q['answer'] = idx
            q['type'] = 'multi' if len(idx) > 1 else 'single'
        out.append(q)
    for i, q in enumerate(out):
        q['id'] = f'q{i}'
    return out, not all(q.get('answer') for q in out)


# задания «Проверь себя» для модулей, где в материалах преподавателя нет готового теста
SELF_TESTS = [t for f in sorted(Path(__file__).parent.glob('self_tests_*.json')) for t in json.loads(f.read_text('utf-8'))['tests']]


def self_test(entry):
    """Короткая запись задания (t, q, o, p, a, e) → полный объект задания курса с проверкой формата."""
    qs = []
    for i, q in enumerate(entry['questions']):
        t, o, pr = q['t'], q.get('o', []), q.get('p', [])
        where = f'{entry["title"]}, задание {i + 1}'
        assert len(o) <= 12 and len(set(o)) == len(o), where
        if t == 'single':
            assert len(q['a']) == 1 and 0 <= q['a'][0] < len(o), where
        if t == 'multi':
            assert q['a'] and all(0 <= a < len(o) for a in q['a']), where
        if t == 'order':
            assert len(o) >= 2, where
        if t == 'match':
            assert len(o) >= 2 and len(pr) == len(o) and len(set(pr)) == len(pr), where
        if t == 'short':
            assert q['a'] and all(isinstance(a, str) for a in q['a']), where
        answer = list(range(len(o))) if t == 'order' else [] if t == 'match' else q['a']
        qs.append({'id': f'q{i}', 'type': t, 'text': q['q'], 'options': o, 'pairs': pr, 'answer': answer, 'explain': q.get('e', ''), 'points': 1})
    return {'title': entry['title'],
            'settings': {'timeLimitMin': 0, 'attempts': 0, 'shuffle': True, 'passPercent': 60, 'mode': 'self', 'pick': 0, 'draft': False},
            'questions': qs}


def main():
    global IMAGES
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    mat = Path(sys.argv[1])
    IMAGES = Images()
    report = []

    plan = structure(mat / 'Содержание' / 'Содержание.xlsx')
    lessons = {l['n']: l for s in plan for l in s['lessons'] if l.get('n')}

    # лекции
    lec_files = sorted((mat / 'Теоретический раздел').glob('*.docx'), key=lambda p: (int(re.match(r'\d+', p.name).group(0)), p.name))
    lectures = {}
    for f in lec_files:
        n = int(re.match(r'\d+', f.name).group(0))
        lec = lecture(f, f'l{n:02d}')
        lectures.setdefault(n, []).append(lec)
        report.append(f'лекция {n}: {lec["title"][:60]} — блоков {len(lec["blocks"])}')

    # лабораторные
    lab_doc = next((mat / 'ТРПО Метод_рек к Лаб_Р').glob('*.docx'))
    all_labs = labs(lab_doc)
    for lab in all_labs:
        report.append(f'ЛР {lab["n"]}: блоков {len(lab["blocks"])}, вариантов {len(lab["variants"])}, вопросов {len(lab["questions"])}')

    # тесты
    tests = {}
    tdir = mat / 'Тесты'
    sdir = mat / 'Самостоятельные работы'
    for files, where, title, mode in TESTS:
        names = files if isinstance(files, list) else [files]
        bank = []
        pick = 0
        draft = False
        for name in names:
            cand = list(tdir.glob('*' + name)) + list(sdir.glob('*' + name))
            if not cand:
                report.append(f'тест не найден: {name}')
                continue
            got, note = build_test(cand[0], 't' + hashlib.md5(name.encode()).hexdigest()[:6])
            report.append(f'тест «{title}» ← {name}: {note}')
            if got:
                draft = draft or got['draft']
                start = len(bank)
                for q in got['questions']:
                    q['id'] = f'q{start + int(q["id"][1:])}'
                bank += got['questions']
                pick = pick + (got['pick'] or len(got['questions'])) if len(names) == 1 else max(pick, len(got['questions']))
        bank, keyed = apply_key(title, bank)
        if keyed is not None:
            draft = keyed
            pick = min(pick, len(bank)) if pick else 0
        if len(bank) >= 3:
            per = pick if len(names) > 1 else (pick if pick and pick < len(bank) else 0)
            tests.setdefault(where, []).append({
                'title': title,
                'settings': {'timeLimitMin': 20 if mode == 'control' else 0, 'attempts': 1 if mode == 'control' else 0, 'shuffle': True, 'passPercent': 60, 'mode': mode, 'pick': per if per < len(bank) else 0, 'draft': draft},
                'questions': bank,
            })

    # сборка
    course_sections = []
    used_labs = set()
    for s in plan:
        mods = []
        for l in s['lessons']:
            if l.get('okr'):
                key = f'okr{l["okr"]}'
                mods.append({'title': l['title'], 'hours': l['hours'], 'goal': 'Проверить знания по пройденным разделам.', 'tasks': [], 'outcomes': [], 'lectures': [], 'tests': tests.get(key, []), 'labs': []})
                continue
            n = l['n']
            lecs = lectures.get(n, [])
            mod_labs = []
            for lab in all_labs:
                if LAB_LESSON.get(lab['n']) == n:
                    item = {k: lab[k] for k in ('title', 'goal', 'description', 'blocks', 'questions', 'variants', 'criteria')}
                    item['diagramKind'] = DIAGRAM_LAB.get(lab['n'])
                    mod_labs.append(item)
                    used_labs.add(lab['n'])
            for fname, where, title in SELF_STUDY_LABS:
                if where == n:
                    f = next(sdir.glob('*' + fname), None)
                    if f:
                        ss = self_study(f, 'ss' + str(n))
                        mod_labs.append({'title': title, 'goal': 'Закрепить материал темы.', 'description': '', 'blocks': ss['blocks'], 'questions': [], 'variants': ss['variants'], 'criteria': ['ответы полные и верные'], 'diagramKind': None})
            lec_items = [{'title': l['title'] if len(lecs) == 1 else x['title'], 'blocks': x['blocks']} for x in lecs]
            if n == 5:
                lec_items.append({'title': 'Кроссворд: жизненный цикл ПО', 'blocks': [{'type': 'note', 'text': 'Проверьте себя: разгадайте кроссворд по разделу I. Нажмите на клетку и вводите буквы; «Проверить» подсветит ошибки.', 'tone': 'info'}, CROSSWORD]})
            mods.append({
                'title': l['title'],
                'hours': l['hours'],
                'goal': lecs[0]['goal'] if lecs else '',
                'tasks': lecs[0]['tasks'] if lecs else [],
                'outcomes': [],
                'lectures': lec_items,
                'tests': tests.get(n, []),
                'labs': mod_labs,
            })
        course_sections.append({'title': s['title'], 'modules': mods})

    # модуль без готового теста получает «Проверь себя»
    used_self = set()
    for sec in course_sections:
        for m in sec['modules']:
            if any(not t['settings'].get('draft') for t in m['tests']):
                continue
            entry = next((e for e in SELF_TESTS if m['title'].startswith(e['module'])), None)
            if entry:
                m['tests'].append(self_test(entry))
                used_self.add(entry['module'])
                report.append(f'«{entry["title"]}»: заданий {len(entry["questions"])}')
            elif m['lectures']:
                report.append(f'нет теста в модуле: {m["title"]}')
    assert len(used_self) == len(SELF_TESTS), [e['module'] for e in SELF_TESTS if e['module'] not in used_self]

    missing = [lab['n'] for lab in all_labs if lab['n'] not in used_labs]
    cells = check_crossword(CROSSWORD)
    course = {
        'title': 'Технология разработки программного обеспечения',
        'description': 'Полный курс дисциплины: жизненный цикл ПО, методы проектирования (IDEF0, IDEF3, BPMN, DFD, UML), шаблоны проектирования, тестирование, качество и гибкие методологии. Лекции, тесты, 32 лабораторные работы и самостоятельные работы.',
        'sections': course_sections,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(course, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    for line in report:
        print(line)
    n_mod = sum(len(s['modules']) for s in course_sections)
    all_tests = [t for sec in course_sections for m in sec['modules'] for t in m['tests']]
    ready = [t for t in all_tests if not t['settings'].get('draft')]
    bare = [m['title'] for sec in course_sections for m in sec['modules'] if m['lectures'] and not any(not t['settings'].get('draft') for t in m['tests'])]
    print('---')
    print(f'разделов {len(course_sections)}, модулей {n_mod}, лекций {sum(len(v) for v in lectures.values())}, лабораторных {len(all_labs)} (не привязаны: {missing})')
    print(f'тестов {len(all_tests)} ({sum(len(t["questions"]) for t in all_tests)} заданий), готовых {len(ready)} ({sum(len(t["questions"]) for t in ready)} заданий), черновиков {len(all_tests) - len(ready)}; модулей с лекцией без готового теста: {len(bare)}')
    print(f'рисунков {IMAGES.count} ({IMAGES.bytes // 1024} КБ), не открылось {IMAGES.failed}; клеток кроссворда {cells}')
    print(f'курс: {OUT_JSON} ({OUT_JSON.stat().st_size // 1024} КБ)')


if __name__ == '__main__':
    main()
