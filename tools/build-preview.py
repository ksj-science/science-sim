#!/usr/bin/env python3
"""시뮬레이터 미리보기용 한 파일 만들기 (선생님 실시간 확인용 Artifact 링크에 씀)

사용법: python3 tools/build-preview.py <단원ID> <출력파일>
- lib/sim.css, lib/sim-bridge.js 를 파일 안에 넣고 <html>/<head>/<body> 태그를 걷어 냅니다.
- 크롬북보다 좁은 화면(휴대폰)에서는 한 줄로 쌓고 세로 스크롤을 허용합니다.
- 결과물은 저장소에 올리지 않습니다(작업용 임시 파일).
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
unit, out = sys.argv[1], pathlib.Path(sys.argv[2])
html = (root / 'sims' / unit / 'index.html').read_text(encoding='utf-8')
css = (root / 'lib' / 'sim.css').read_text(encoding='utf-8')
js = (root / 'lib' / 'sim-bridge.js').read_text(encoding='utf-8')

html = html.replace('<link rel="stylesheet" href="../../lib/sim.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="../../lib/sim-bridge.js"></script>', '<script>\n' + js + '\n</script>')
html = re.sub(r'<!DOCTYPE[^>]*>|</?html[^>]*>|</?head>|</?body>|<meta charset[^>]*>|<meta name="viewport"[^>]*>|<link rel="icon"[^>]*>', '', html, flags=re.I)
extra = """<style>
:root { color-scheme: light; }
body { background: var(--bg); color: var(--ink); }
@media (max-width: 900px) {
  html, body { overflow: auto !important; height: auto !important; }
  .sim-main { grid-template-columns: 1fr !important; }
  .col { grid-template-rows: auto !important; }
  .canvas-box { min-height: 360px; }
}
</style>
"""
out.write_text(html.strip() + '\n' + extra, encoding='utf-8')
print('wrote', out)
