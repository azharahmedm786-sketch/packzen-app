import os
import filecmp

root_files = set()
public_files = set()

extensions = ('.html', '.js', '.css', '.json', '.jpg', '.png', '.svg', '.xml', '.txt')

ignore_dirs = {'.git', 'node_modules', 'functions', 'public', 'tests', 'twa', 'backup'}

for root_dir, dirs, files in os.walk('.'):
    # filter dirs
    dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith('.')]

    # We only care about files in the root dir and its subdirectories that are NOT public
    for f in files:
        if f.endswith(extensions):
            path = os.path.relpath(os.path.join(root_dir, f), '.')
            root_files.add(path)

for root_dir, dirs, files in os.walk('public'):
    dirs[:] = [d for d in dirs if not d.startswith('.')]
    for f in files:
        if f.endswith(extensions):
            path = os.path.relpath(os.path.join(root_dir, f), 'public')
            public_files.add(path)

identical = []
different = []
root_only = sorted(list(root_files - public_files))
public_only = sorted(list(public_files - root_files))

for f in root_files.intersection(public_files):
    if filecmp.cmp(f, os.path.join('public', f), shallow=False):
        identical.append(f)
    else:
        different.append(f)

identical.sort()
different.sort()

with open('audit_report.txt', 'w') as out:
    out.write("=== IDENTICAL ===\n")
    for f in identical: out.write(f + "\n")
    out.write("\n=== DIFFERENT ===\n")
    for f in different: out.write(f + "\n")
    out.write("\n=== ROOT ONLY ===\n")
    for f in root_only: out.write(f + "\n")
    out.write("\n=== PUBLIC ONLY ===\n")
    for f in public_only: out.write(f + "\n")
