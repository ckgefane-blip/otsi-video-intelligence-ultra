"""Generates DATA_DICTIONARY.md and ERD.md from the LIVE validated MySQL catalogue (docs/_*.tsv)."""
import os, re, collections
D = os.path.dirname(os.path.abspath(__file__))
def tsv(n): return [l.rstrip('\n').split('\t') for l in open(os.path.join(D, 'docs', n), encoding='utf-8') if l.strip()]
cols, fks, idx, chk = tsv('_cols.tsv'), tsv('_fks.tsv'), tsv('_idx.tsv'), tsv('_chk.tsv')
# table -> migration module
mod = {}
for f in sorted(os.listdir(os.path.join(D, 'sql_src'))):
    for t in re.findall(r'^CREATE TABLE (\w+)', open(os.path.join(D, 'sql_src', f), encoding='utf-8').read(), re.M):
        mod[t] = f[:-4]
T = collections.OrderedDict()
for r in cols:
    T.setdefault(r[0], {'cols': [], 'comment': r[9]})['cols'].append(r)
FK = collections.defaultdict(list); IX = collections.defaultdict(list); CK = collections.defaultdict(list)
for r in fks: FK[r[0]].append(r)
for r in idx: IX[r[0]].append(r)
for r in chk: CK[r[0]].append(r)
esc = lambda s: (s or '').replace('|', '\\|')
L = ['# OTSI VIE — Data Dictionary (generated from the validated MySQL 8.4.13 catalogue)\n',
     f'{len(T)} tables · {len(cols)} columns · {len(fks)} foreign keys · {len(idx)} indexes · {len(chk)} CHECK constraints. Grouped by migration module. Column comments name the UI element each column feeds.\n']
bymod = collections.defaultdict(list)
for t in T: bymod[mod.get(t, 'zz')].append(t)
L.append('## Index\n')
for m in sorted(bymod):
    L.append(f'- **{m}**: ' + ', '.join(f'[`{t}`](#{t})' for t in bymod[m]))
for m in sorted(bymod):
    L.append(f'\n---\n## Module {m}\n')
    for t in bymod[m]:
        L.append(f'### {t}\n')
        if T[t]['comment']: L.append(f'_{esc(T[t]["comment"])}_\n')
        L.append('| # | column | type | null | default / extra | key | UI / meaning |\n|---|---|---|---|---|---|---|')
        for c in T[t]['cols']:
            L.append(f'| {c[1]} | `{c[2]}` | {esc(c[3])} | {c[4]} | {esc((c[5] + " " + c[6]).strip())} | {c[7]} | {esc(c[8])} |')
        if FK[t]:
            L.append('\nForeign keys: ' + '; '.join(f'`{f[2]}` → `{f[3]}({f[4]})` {f[5]}' for f in FK[t]))
        if IX[t]:
            L.append('\nIndexes: ' + '; '.join(f'{"UNIQUE " if i[2] == "0" else ""}{i[3] + " " if i[3] != "BTREE" else ""}`{i[1]}`({i[4]})' for i in IX[t]))
        if CK[t]:
            L.append('\nChecks: ' + '; '.join(f'`{c[1]}`: {esc(c[2][:300])}' for c in CK[t]))
        L.append('')
open(os.path.join(D, 'docs', 'DATA_DICTIONARY.md'), 'w', encoding='utf-8').write('\n'.join(L))
# ERD per module (Mermaid)
E = ['# OTSI VIE — Entity Relationship Diagrams (Mermaid, generated from live FKs)\n',
     'One diagram per module; cross-module references are drawn to the referenced entity. Render in GitHub, VS Code (Markdown Preview Mermaid) or mermaid.live.\n']
for m in sorted(bymod):
    tabs = set(bymod[m]); lines = set()
    for t in tabs:
        for f in FK[t]:
            if f[3] in ('users', 'organizations') and m not in ('001_foundation_identity_storage',): continue
            lines.add(f'  {f[3]} ||--o{{ {t} : "{f[2].split(",")[-1]}"')
    E.append(f'## {m}\n```mermaid\nerDiagram')
    for t in sorted(tabs):
        pk = [c for c in T[t]['cols'] if c[7] == 'PRI']
        E.append(f'  {t} {{')
        for c in pk[:3]: E.append(f'    {re.sub(r"[^a-z0-9]", "_", c[3].split("(")[0].lower())} {c[2]} PK')
        E.append('  }')
    E += sorted(lines)
    E.append('```\n')
E.append('Note: `users` and `organizations` edges are omitted outside module 001 for legibility; every tenant table carries `organization_id`.')
open(os.path.join(D, 'docs', 'ERD.md'), 'w', encoding='utf-8').write('\n'.join(E))
print(len(T), 'tables documented')
