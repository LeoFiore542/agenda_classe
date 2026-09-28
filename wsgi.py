"""
WSGI entry point for PythonAnywhere.

In the PythonAnywhere Web tab, set the WSGI file to this path, e.g.:
/home/<username>/aGenda/wsgi.py

Adjust project_home below if your folder name is different.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

project_home = str(Path(__file__).resolve().parent)
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Optional: set a strong secret on the server (Web > Environment variables, or here)
# os.environ.setdefault("SECRET_KEY", "cambia-questa-chiave")

from app import create_app

application = create_app()
