#!/usr/bin/env python3
"""
serve.py — ModelProbe v10.5.5 dev server

Serves dist/ with Cache-Control: no-store so stale files never bleed in.
Also exposes two API endpoints used by storage.js for direct file saves:

  GET  /api/ping        → 200 {"ok":true}  (client uses this to detect local server)
  POST /api/save        → writes JSON body to dist/CONFIGS/<filename>
                          Body: { "filename": "providers.json", "content": "..." }
                          Response: 200 {"ok":true} or 4xx/5xx {"error":"..."}

These endpoints allow save to write directly to CONFIGS/ on all browsers
(including Firefox / Safari which have no File System Access API support).

Usage:
    python3 serve.py [PORT]   (default: 8080)
"""
import http.server, json, os, re, sys, webbrowser, threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

# Files the save endpoint is allowed to write — whitelist for safety
SAVE_WHITELIST = {'providers.json', 'models.json', 'rules.json', 'prompts.json'}

# Request log files — written to dist/LOGS/, one per session
LOGS_DIR        = os.path.join(DIST, 'LOGS')
LOG_MAX_BYTES   = 5 * 1024 * 1024  # 5 MB per file before rollover
# Valid log filename: YYYY-MM-DD-{alphanumeric}.log or rollover variant .1.log, .2.log …
LOG_FILENAME_RE = re.compile(r'^\d{4}-\d{2}-\d{2}-[a-z0-9]+(\.\d+)?\.log$')


class ModelProbeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    # ── API routes ────────────────────────────────────────────────────────

    def do_GET(self):
        if self.path == '/api/ping':
            self._json(200, {'ok': True})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/save':
            self._handle_save()
            return
        if self.path == '/api/log':
            self._handle_log_append()
            return
        if self.path == '/api/log-delete':
            self._handle_log_delete()
            return
        if self.path == '/api/log-delete-all':
            self._handle_log_delete_all()
            return
        self._json(404, {'error': 'Not found'})

    def do_OPTIONS(self):
        # Allow preflight requests (in case front-end runs on a different port)
        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _handle_save(self):
        try:
            body     = self._read_body()
            filename = body.get('filename', '')
            content  = body.get('content',  '')

            if filename not in SAVE_WHITELIST:
                self._json(400, {'error': f'Filename not allowed: {filename}'})
                return

            configs_dir = os.path.join(DIST, 'CONFIGS')
            os.makedirs(configs_dir, exist_ok=True)
            dest = os.path.join(configs_dir, filename)

            with open(dest, 'w', encoding='utf-8') as f:
                f.write(content)

            print(f'  Saved → CONFIGS/{filename}  ({len(content)} bytes)')
            self._json(200, {'ok': True})

        except json.JSONDecodeError as e:
            self._json(400, {'error': 'Invalid JSON body: ' + str(e)})
        except OSError as e:
            self._json(500, {'error': 'Write failed: ' + str(e)})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ── Helpers ───────────────────────────────────────────────────────────

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def _handle_log_append(self):
        """Append one NDJSON line to dist/LOGS/{date}-{sessionId}.log.
        Rolls over to .1.log, .2.log … when a file reaches LOG_MAX_BYTES."""
        try:
            body     = self._read_body()
            filename = body.get('filename', '')
            entry    = body.get('entry', '')

            if not LOG_FILENAME_RE.match(filename):
                self._json(400, {'error': 'Invalid log filename: ' + filename})
                return

            os.makedirs(LOGS_DIR, exist_ok=True)

            # Resolve the current write target, rolling over if needed
            dest = self._resolve_log_path(filename)
            with open(dest, 'a', encoding='utf-8') as f:
                f.write(entry + '\n')

            self._json(200, {'ok': True, 'file': os.path.basename(dest)})

        except (json.JSONDecodeError, OSError) as e:
            self._json(500, {'error': str(e)})

    def _resolve_log_path(self, base_filename):
        """Return the path to append to, rolling over at LOG_MAX_BYTES.
        base_filename must end in .log (not already a rollover name)."""
        base = os.path.join(LOGS_DIR, base_filename)  # e.g. LOGS/2026-06-04-abc.log
        stem = base_filename[:-4]                       # strip '.log'

        candidate = base
        index = 0
        while True:
            if not os.path.exists(candidate):
                return candidate  # new file — safe to create
            if os.path.getsize(candidate) < LOG_MAX_BYTES:
                return candidate  # still has room
            # Roll over
            index += 1
            candidate = os.path.join(LOGS_DIR, f'{stem}.{index}.log')

    def _handle_log_delete(self):
        """Delete all log files for a single session (including rollovers)."""
        try:
            body      = self._read_body()
            session_id = body.get('sessionId', '')
            date       = body.get('date', '')

            if not session_id or not re.match(r'^[a-z0-9]+$', session_id):
                self._json(400, {'error': 'Invalid sessionId'})
                return

            deleted = self._delete_session_logs(session_id, date)
            self._json(200, {'ok': True, 'deleted': deleted})

        except (json.JSONDecodeError, OSError) as e:
            self._json(500, {'error': str(e)})

    def _handle_log_delete_all(self):
        """Delete log files for multiple sessions in one call."""
        try:
            body     = self._read_body()
            sessions = body.get('sessions', [])
            total    = 0
            for s in sessions:
                sid  = s.get('id', '')
                date = (s.get('createdAt') or '')[:10]
                if sid and re.match(r'^[a-z0-9]+$', sid):
                    total += self._delete_session_logs(sid, date)
            self._json(200, {'ok': True, 'deleted': total})

        except (json.JSONDecodeError, OSError) as e:
            self._json(500, {'error': str(e)})

    def _delete_session_logs(self, session_id, date):
        """Delete base + all rollover .log files for a session. Returns count deleted."""
        if not os.path.isdir(LOGS_DIR):
            return 0
        deleted = 0
        base_stem = f'{date}-{session_id}' if date else session_id
        for fname in os.listdir(LOGS_DIR):
            # Match: {date}-{id}.log  or  {date}-{id}.N.log
            if re.match(rf'^{re.escape(base_stem)}(\.\d+)?\.log$', fname):
                try:
                    os.remove(os.path.join(LOGS_DIR, fname))
                    deleted += 1
                except FileNotFoundError:
                    pass
        return deleted

    def _json(self, code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self._cors_headers()
        self.send_header('Content-Type',   'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma',        'no-cache')
        self.send_header('Expires',       '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        msg  = str(args[0]) if args else ''
        code = str(args[1]) if len(args) > 1 else ''
        # Suppress favicon 404s (browser noise) and tags.json 404.
        # tags.json is a legacy standalone-tags fallback path; tags are now
        # embedded in rules.json. The client catches the 404 gracefully —
        # logging it as a server error is misleading.
        if '404' in code and ('favicon' in msg or 'tags.json' in msg):
            return
        super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(DIST)
    url = f'http://localhost:{PORT}/'
    print(f'\n  ModelProbe v10.5.5 — {url}  (Ctrl+C to stop)')
    print(f'  Serving dist/ | Save API: POST /api/save\n')
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    with http.server.HTTPServer(('', PORT), ModelProbeHandler) as srv:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print('\n  Server stopped.')
