#!/usr/bin/env bash
PORT="${1:-8080}"
echo "  Building ModelProbe v10.5.5…"
python3 build.py || { echo "  Build failed"; exit 1; }
python3 serve.py "$PORT"
