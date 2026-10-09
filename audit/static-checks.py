"""Parse every Python source without importing or executing app code."""
import ast
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
paths = sorted((root / 'engine').rglob('*.py'))
failures = []
for p in paths:
    try:
        ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p))
    except (SyntaxError, UnicodeError) as exc:
        failures.append({'file': str(p.relative_to(root)), 'error': str(exc)})
print(json.dumps({'filesParsed': len(paths), 'failures': failures}, indent=2))
raise SystemExit(bool(failures))
