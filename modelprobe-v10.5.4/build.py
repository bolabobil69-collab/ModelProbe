#!/usr/bin/env python3
"""
build.py — ModelProbe v10.5.5 bundler

Produces:
  dist/index.html          — single self-contained bundle
  dist/CONFIGS/*.json      — initial config files (copied from assets/data/)

Usage:
    python3 build.py            # one-shot build
    python3 build.py --watch    # rebuild on change (polls every 2s)
"""

import json, os, re, shutil, sys, time

SRC  = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(SRC, 'dist')
OUT  = os.path.join(DIST, 'index.html')

JS_ORDER = [
    'assets/js/utils.js',
    'assets/js/state.js',
    'assets/js/storage.js',
    'assets/js/views.js',
    'assets/js/utils/dragdrop.js',
    'assets/js/components/providers.js',
    'assets/js/components/models.js',
    'assets/js/components/rules.js',
    'assets/js/components/tags-manager.js',
    'assets/js/components/chat.js',
    'assets/js/components/log.js',
    'assets/js/components/history.js',
    'assets/js/components/context.js',
    'assets/js/components/batch.js',
    'assets/js/components/free-providers.js',
    'assets/js/api.js',
    'assets/js/main.js',
]

# Inlined as DEFAULT_* globals in the bundle — used as offline fallback
# when CONFIGS/ files can't be fetched.
DATA_FILES = [
    ('DEFAULT_PROVIDERS', 'assets/data/default-providers.json'),
    ('DEFAULT_MODELS',    'assets/data/default-models.json'),
    ('DEFAULT_RULES',     'assets/data/default-rules.json'),
    ('DEFAULT_TAGS',      'assets/data/default-tags.json'),
    ('DEFAULT_PROMPTS',   'assets/data/default-prompts.json'),
]

# CONFIGS/ output: (dest filename, source path, transform_fn or None)
# rules.json is a combination of default-rules.json + default-tags.json
CONFIGS_FILES = [
    ('providers.json', 'assets/data/default-providers.json', None),
    ('models.json',    'assets/data/default-models.json',    None),
    ('prompts.json',   'assets/data/default-prompts.json',   None),
    # rules.json is built separately (see _build_configs_rules_json)
]

def read(path):
    with open(os.path.join(SRC, path), encoding='utf-8') as f:
        return f.read()

def strip_module_syntax(js):
    """Strip ES module import/export keywords, keeping all declarations intact."""
    js = re.sub(r'^\s*import\s*\{[^}]*\}\s*from\s*[\'"][^\'"]*[\'"]\s*;?\s*$',
                '', js, flags=re.MULTILINE)
    js = re.sub(r'^\s*import\s+\*\s+as\s+\w+\s+from\s*[\'"][^\'"]*[\'"]\s*;?\s*$',
                '', js, flags=re.MULTILINE)
    js = re.sub(r'^\s*import\s+\w+\s+from\s*[\'"][^\'"]*[\'"]\s*;?\s*$',
                '', js, flags=re.MULTILINE)
    js = re.sub(r'\bexport\s+async\s+function\b', 'async function', js)
    js = re.sub(r'\bexport\s+function\b', 'function', js)
    js = re.sub(r'\bexport\s+const\b',    'const',    js)
    js = re.sub(r'\bexport\s+let\b',      'let',      js)
    js = re.sub(r'\bexport\s+var\b',      'var',      js)
    js = re.sub(r'\bexport\s+class\b',    'class',    js)
    js = re.sub(r'\bexport\s+default\b',  '',         js)
    js = re.sub(r'^\s*export\s*\{[^}]*\}\s*;?\s*$', '', js, flags=re.MULTILINE)
    return js

def validate_sources():
    """Pre-flight: catch bugs that silently break the bundle."""
    errors = []
    for path in JS_ORDER:
        full = os.path.join(SRC, path)
        with open(full, encoding='utf-8') as f:
            lines = f.readlines()
        for i, line in enumerate(lines, 1):
            bad_chars = [c for c in line.rstrip('\n\r') if ord(c) < 32 and c != '\t']
            if bad_chars:
                errors.append(f'{path}:{i}: embedded control char {[hex(ord(c)) for c in bad_chars]}')
            if re.search(r"'[^'\\]*[a-z]'s[ ?!,]", line):
                errors.append(f'{path}:{i}: apostrophe in single-quoted string → {line.rstrip()}')
    return errors

def _build_configs_rules_json(rules_path, tags_path):
    """Combine default-rules.json + default-tags.json → CONFIGS/rules.json."""
    with open(os.path.join(SRC, rules_path), encoding='utf-8') as f:
        rules = json.load(f)
    with open(os.path.join(SRC, tags_path), encoding='utf-8') as f:
        tags = json.load(f)
    return json.dumps({'tags': tags, 'rules': rules}, indent=2, ensure_ascii=False)

def build():
    os.makedirs(DIST, exist_ok=True)

    # 0. Validate sources
    errs = validate_sources()
    if errs:
        print('  BUILD ABORTED — source errors:')
        for e in errs:
            print('    \u2717 ' + e)
        sys.exit(1)

    # 1. CSS
    css = read('assets/css/style.css')

    # 2. JSON data → JS const declarations (offline fallback in bundle)
    data_parts = ['// \u2500\u2500 Bundled data (offline fallback) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500']
    for const_name, path in DATA_FILES:
        data_parts.append(f'const {const_name} = {read(path)};')
    data_js = '\n'.join(data_parts)

    # 3. Bundle JS modules
    js_parts = [data_js, '\n// \u2500\u2500 Modules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n']
    for path in JS_ORDER:
        stripped = strip_module_syntax(read(path))
        js_parts.append(f'\n// === {path} ===\n{stripped}')
    bundled_js = '\n'.join(js_parts)

    # 4. Assemble HTML
    html = read('index.html')
    html = re.sub(r'<link[^>]+style\.css[^>]*>\n?', '', html)
    html = re.sub(r'<script[^>]+type="module"[^>]*></script>\n?', '', html)
    html = html.replace('</head>', f'<style>\n{css}\n</style>\n</head>', 1)
    html = html.replace('</body>', f'<script>\n{bundled_js}\n</script>\n</body>', 1)

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)

    size_kb = os.path.getsize(OUT) / 1024
    print(f'  Built \u2192 dist/index.html  ({size_kb:.1f} KB)  [{time.strftime("%H:%M:%S")}]')

    # 5. Write CONFIGS/ (only creates files that don't already exist)
    configs_dir = os.path.join(DIST, 'CONFIGS')
    os.makedirs(configs_dir, exist_ok=True)

    created, skipped = [], []
    for dest_name, src_path, _ in CONFIGS_FILES:
        dest = os.path.join(configs_dir, dest_name)
        if not os.path.exists(dest):
            shutil.copy2(os.path.join(SRC, src_path), dest)
            created.append(dest_name)
        else:
            skipped.append(dest_name)

    # rules.json — combined format
    rules_dest = os.path.join(configs_dir, 'rules.json')
    if not os.path.exists(rules_dest):
        content = _build_configs_rules_json(
            'assets/data/default-rules.json',
            'assets/data/default-tags.json',
        )
        with open(rules_dest, 'w', encoding='utf-8') as f:
            f.write(content)
        created.append('rules.json')
    else:
        skipped.append('rules.json')

    if created:
        print(f'  CONFIGS/ created: {", ".join(created)}')
    if skipped:
        print(f'  CONFIGS/ kept:    {", ".join(skipped)}  (user files preserved)')

    return OUT

def _source_files():
    files = list(JS_ORDER) + [p for _, p in DATA_FILES]
    files += ['index.html', 'assets/css/style.css']
    return [os.path.join(SRC, f) for f in files]

def watch():
    print('  Watching for changes\u2026 (Ctrl+C to stop)')
    prev = {f: os.path.getmtime(f) for f in _source_files() if os.path.exists(f)}
    try:
        while True:
            time.sleep(2)
            cur = {f: os.path.getmtime(f) for f in _source_files() if os.path.exists(f)}
            changed = [f for f in cur if cur[f] != prev.get(f)]
            if changed:
                for f in changed:
                    print(f'  Changed: {os.path.relpath(f, SRC)}')
                try:
                    build()
                except Exception as e:
                    print(f'  Build error: {e}')
            prev = cur
    except KeyboardInterrupt:
        print('\n  Watch stopped.')

if __name__ == '__main__':
    print('ModelProbe v10.5.5 — build.py')
    print(f'  Source: {SRC}')
    print(f'  Output: {DIST}/\n')
    build()
    if '--watch' in sys.argv:
        watch()
