"""Inlines district.json into template.html -> a single self-contained page.

    python3 assemble.py district.json out.html
"""
import sys
from pathlib import Path
here = Path(__file__).parent
page = (here / 'template.html').read_text().replace('/*__DISTRICT__*/', Path(sys.argv[1]).read_text())
Path(sys.argv[2]).write_text(page)
print(sys.argv[2], round(len(page) / 1e6, 2), 'MB')
