"""uv run python -m app: serve on PORT (default 8000)."""

import os

import uvicorn

from .config import load_env_file

load_env_file()
uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
