#!/usr/bin/env python3
"""시뮬레이터 미리보기용 한 파일 만들기 (선생님 실시간 확인용 Artifact 링크에 씀)

사용법: python3 tools/build-preview.py <단원ID> <출력파일>
- 시뮬레이터 폴더의 스타일시트(<link rel="stylesheet">)와 일반 스크립트(<script src>)를 파일 안에 넣습니다.
- ES 모듈(<script type="module" src>)은 importmap·상대 경로를 따라 쓰인 모듈을 모두 모아 넣고,
  실행할 때 blob 주소로 바꿔 불러옵니다(Three.js 같은 lib/vendor 라이브러리 포함).
- <html>/<head>/<body> 태그를 걷어 냅니다.
- 크롬북보다 좁은 화면(휴대폰)에서는 한 줄로 쌓고 세로 스크롤을 허용합니다.
- 결과물은 저장소에 올리지 않습니다(작업용 임시 파일).
"""
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
unit, out = sys.argv[1], pathlib.Path(sys.argv[2])
sim_dir = root / 'sims' / unit
html = (sim_dir / 'index.html').read_text(encoding='utf-8')


def local(href):
    """페이지 기준 상대 경로 → 실제 파일 (바깥 주소·data: 는 None)"""
    if re.match(r'^(?:[a-z]+:|//)', href, re.I):
        return None
    p = (sim_dir / href.split('?')[0].split('#')[0]).resolve()
    return p if p.is_file() and root in p.parents else None


def safe_script(s):
    return s.replace('</script', '<\\/script')


# 1) 스타일시트
def css_repl(m):
    p = local(m.group(1))
    if not p:
        return m.group(0)
    return '<style>\n' + p.read_text(encoding='utf-8').replace('</style', '<\\/style') + '\n</style>'


html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', css_repl, html, flags=re.I)

# 2) importmap 읽기 (모듈 모으기에 씀) — 결과물에서는 지움
importmap = {}
m = re.search(r'<script\s+type="importmap"\s*>(.*?)</script>', html, re.S | re.I)
if m:
    importmap = json.loads(m.group(1)).get('imports', {})
    html = html.replace(m.group(0), '')

# 3) ES 모듈 모으기
IMPORT_RE = re.compile(
    r'''(\b(?:import|export)\s[^'";]*?\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2''', re.S)
modules = {}  # 실제 경로 → {'id', 'src', 'deps'}


def resolve(spec, base):
    """모듈 이름 → 실제 파일 (base: 가져오는 모듈의 실제 경로)"""
    if spec.startswith(('./', '../', '/')):
        p = (base.parent / spec).resolve()
    else:
        target = None
        if spec in importmap:
            target = importmap[spec]
        else:
            for k, v in importmap.items():
                if k.endswith('/') and spec.startswith(k):
                    target = v + spec[len(k):]
                    break
        if target is None:
            raise SystemExit(f'모듈을 찾을 수 없음: {spec} ({base})')
        p = (sim_dir / target).resolve()
    if not p.is_file():
        raise SystemExit(f'모듈 파일 없음: {spec} → {p}')
    return p


def collect(path):
    if path in modules:
        return
    src = path.read_text(encoding='utf-8')
    entry = {'id': len(modules), 'deps': []}
    modules[path] = entry

    def repl(m):
        dep = resolve(m.group(3), path)
        collect(dep)
        entry['deps'].append(modules[dep]['id'])
        return m.group(1) + m.group(2) + f'__PREVIEW_MOD_{modules[dep]["id"]}__' + m.group(2)

    entry['src'] = IMPORT_RE.sub(repl, src)


entries = []


def mod_repl(m):
    p = local(m.group(1))
    if not p:
        return m.group(0)
    collect(p)
    entries.append(modules[p]['id'])
    return ''


html = re.sub(r'<script\s+type="module"\s+src="([^"]+)"\s*>\s*</script>', mod_repl, html, flags=re.I)


# 3-1) 본문에 바로 쓴 모듈(<script type="module">…</script>)도 같은 방식으로 묶음 — 문서 순서대로 실행
def inline_mod_repl(m):
    fake = sim_dir / f'__inline_{len(modules)}.js'
    entry = {'id': len(modules), 'deps': []}
    modules[fake] = entry

    def repl(mm):
        dep = resolve(mm.group(3), fake)
        collect(dep)
        entry['deps'].append(modules[dep]['id'])
        return mm.group(1) + mm.group(2) + f'__PREVIEW_MOD_{modules[dep]["id"]}__' + mm.group(2)

    entry['src'] = IMPORT_RE.sub(repl, m.group(1))
    entries.append(entry['id'])
    return ''


html = re.sub(r'<script\s+type="module"\s*>(.*?)</script>', inline_mod_repl, html, flags=re.S | re.I)

# 4) 일반 스크립트
def js_repl(m):
    p = local(m.group(1))
    if not p:
        return m.group(0)
    return '<script>\n' + safe_script(p.read_text(encoding='utf-8')) + '\n</script>'


html = re.sub(r'<script\s+src="([^"]+)"[^>]*>\s*</script>', js_repl, html, flags=re.I)

# 5) 문서 껍데기 걷어 내기
html = re.sub(r'<!DOCTYPE[^>]*>|</?html[^>]*>|</?head>|</?body>|<meta name="viewport"[^>]*>',
              '', html, flags=re.I)
html = re.sub(r'<link\s+rel="icon"\s+href="[^"]*"\s*/?>', '', html, flags=re.I)

loader = ''
if modules:
    table = {e['id']: e['src'] for e in modules.values()}
    loader = (
        '<script>\n(function(){\n'
        'var SRC = ' + safe_script(json.dumps(table, ensure_ascii=False)) + ';\n'
        'var ENTRY = ' + json.dumps(entries) + ';\n'
        'var URLS = {};\n'
        'function url(id){\n'
        '  if (URLS[id]) return URLS[id];\n'
        '  var s = SRC[id].replace(/__PREVIEW_MOD_(\\d+)__/g, function(_, d){ return url(+d); });\n'
        '  return URLS[id] = URL.createObjectURL(new Blob([s], {type: "text/javascript"}));\n'
        '}\n'
        'function start(){ ENTRY.forEach(function(id){ import(url(id)).catch(function(e){ console.error(e); }); }); }\n'
        'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();\n'
        '})();\n</script>\n'
    )

scheme = '' if 'color-scheme' in html else ':root { color-scheme: light; }\n'
extra = """<style>
""" + scheme + """body { background: var(--bg); color: var(--ink); }
@media (max-width: 900px) {
  html, body { overflow: auto !important; height: auto !important; }
  .sim-main { grid-template-columns: 1fr !important; }
  .col { grid-template-rows: auto !important; }
  .canvas-box { min-height: 360px; }
}
</style>
"""
out.write_text(html.strip() + '\n' + loader + extra, encoding='utf-8')
print('wrote', out, f'({out.stat().st_size // 1024} KB, 모듈 {len(modules)}개)')
