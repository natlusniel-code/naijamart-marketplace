#!/usr/bin/env python3
"""
Guard: every column name used in a Supabase query must exist in sql/0001_schema.sql.

TypeScript cannot catch this — `.select("count, bogus_col")` type-checks fine and only
fails at runtime with a 42703. This script parses the migration and diffs it against
select / insert / update payloads in src/.

    python3 scripts/check-columns.py        # exit 1 on any mismatch

Run it after touching the schema or any query.
"""
import glob
import re
import sys

SCHEMA = "sql/0001_schema.sql"
TABLE_RE = re.compile(r"create table if not exists public\.(\w+)\s*\((.*?)\n\);", re.S)
CONSTRAINT_RE = re.compile(r"(constraint|primary key|unique|check|foreign key|exclude)\b", re.I)
COLUMN_RE = re.compile(r"([a-z_][a-z0-9_]*)\s+")


def load_schema():
    src = open(SCHEMA).read()
    tables = {}
    for m in TABLE_RE.finditer(src):
        name, body = m.group(1), m.group(2)
        cols = set()
        for line in body.split("\n"):
            line = line.strip()
            if not line or line.startswith("--") or CONSTRAINT_RE.match(line):
                continue
            cm = COLUMN_RE.match(line)
            if cm:
                cols.add(cm.group(1))
        tables[name] = cols
    return tables


def check_selects(schema, problems):
    for path in glob.glob("src/**/*.ts*", recursive=True):
        src = open(path).read()
        for m in re.finditer(r'\.from\("(\w+)"\)\s*\.select\((?:\s*["\']([^"\']*)["\']|\s*`([^`]*)`)', src, re.S):
            table = m.group(1)
            selection = m.group(2) or m.group(3) or ""
            if table not in schema:
                continue
            sel = re.sub(r"\$\{[^}]*\}", "", selection)  # drop ${SHOP_COLS} interpolation
            flat = re.sub(r"\w+!?\w*\([^)]*\)", "", sel)  # drop embedded `other(cols)`
            for raw in flat.replace("*", "").split(","):
                col = raw.strip().split(":")[-1].strip()
                if not col:
                    continue
                # dotted relation paths (orders.reference) validate only the head
                col = col.split(".")[0]
                if not re.fullmatch(r"[a-z_][a-z0-9_]*", col):
                    continue  # leftover punctuation from a nested embed, not a column
                if col not in schema[table]:
                    line = src[: m.start()].count("\n") + 1
                    problems.append(f"{path}:{line}  select {table}.{col}")


def check_writes(schema, problems):
    for path in glob.glob("src/**/*.ts*", recursive=True):
        src = open(path).read()
        for m in re.finditer(r'\.from\("(\w+)"\)\s*\.(insert|update)\(\s*\{', src):
            table = m.group(1)
            if table not in schema:
                continue
            start = m.end() - 1
            depth = 0
            end = start
            for i in range(start, len(src)):
                if src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            body = src[start + 1 : end]
            depth = 0
            for i, ch in enumerate(body):
                if ch in "{[(":
                    depth += 1
                elif ch in "}])":
                    depth -= 1
                elif ch == ":" and depth == 0:
                    head = body[:i].strip().split("\n")[-1].strip()
                    km = re.match(r"([a-zA-Z_][a-zA-Z0-9_]*)\s*$", head)
                    if km and km.group(1) not in schema[table]:
                        line = src[: m.start()].count("\n") + 1
                        problems.append(f"{path}:{line}  {m.group(2)} {table}.{km.group(1)}")


def main():
    schema = load_schema()
    problems = []
    check_selects(schema, problems)
    check_writes(schema, problems)
    problems = sorted(set(problems))
    for p in problems:
        print("BAD  " + p)
    print(f"{len(schema)} tables checked — {len(problems)} column mismatch(es)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
