import os
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("SUBS_DATA_DIR", tempfile.mkdtemp(prefix="subs-test-"))