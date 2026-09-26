"""Vercel entry point: the FastAPI app from backend/, served as one Python function."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.api.main import app  # noqa: E402,F401
