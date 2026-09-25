import re
import os
import sys
from urllib.parse import urlparse

def check_file():
    with open('public/index.html', 'r', encoding='utf-8') as f:
        content = f.read()

    # Match src="..." and href="..."
    pattern = re.compile(r'(?:src|href)=["\']([^"\']+)["\']')
    matches = pattern.findall(content)

    broken = []

    for match in matches:
        # Ignore external URLs, data URIs, anchor tags
        if match.startswith(('http://', 'https://', 'data:', 'mailto:', 'tel:', '#')):
            continue

        # Remove query params or hashes if present
        parsed = urlparse(match)
        path = parsed.path

        # Paths are typically relative, so if it starts with /, we check it relative to public
        if path.startswith('/'):
            path = path[1:] # e.g. /script.js -> script.js

        if not path:
            continue

        full_path = os.path.join('public', path)
        if not os.path.exists(full_path):
            broken.append(match)

    if broken:
        print("BROKEN REFERENCES:")
        for b in set(broken):
            print(f"- {b}")
        sys.exit(1)
    else:
        print("All local references exist in public/.")

if __name__ == "__main__":
    check_file()
