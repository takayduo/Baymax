# Never bundle local config, API keys, memory, certificates or downloaded plugins.
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

engine = Path(SPECPATH)
datas = [(str(engine / 'core' / 'prompt.txt'), 'core')]
for folder in ('actions', 'plugins'):
    for source in (engine / folder).glob('*.py'):
        datas.append((str(source), folder))
for asset in (engine / 'core').glob('*.obj'):
    datas.append((str(asset), 'core'))
hidden = ['main', 'mochi_runner', 'mochi_bridge', 'ui']
for folder in ('actions', 'core', 'memory', 'plugins'):
    hidden.extend(f'{folder}.{p.stem}' for p in (engine / folder).glob('*.py') if p.stem != '__init__')
hidden += collect_submodules('google.genai')
a = Analysis([str(engine / 'baymax_entry.py')], pathex=[str(engine)],
    binaries=[], datas=datas, hiddenimports=hidden, hookspath=[], hooksconfig={},
    runtime_hooks=[], excludes=['torch', 'tensorflow', 'scipy', 'matplotlib', 'pandas', 'IPython', 'pytest',
                                'transformers', 'sklearn', 'faster_whisper', 'ctranslate2', 'kokoro'],
    noarchive=False)
# Qt on Windows uses the operating system's unversioned ICU API. A build host
# may have an unrelated Poppler/Conda ICU on PATH; bundling that shadows the OS
# DLL and prevents QtCore from importing (missing unversioned exports).
a.binaries = [entry for entry in a.binaries
              if Path(entry[0]).name.lower() not in ('icuuc.dll', 'icudt78.dll')]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='BaymaxEngine',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='BaymaxEngine')
