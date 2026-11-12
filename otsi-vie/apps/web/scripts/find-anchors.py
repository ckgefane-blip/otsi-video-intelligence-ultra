import re
lines = open('src/lib/i18n/dictionaries.ts', encoding='utf-8').read().splitlines()
blocks = {'type': (1, 6711), 'en': (6711, 13404), 'ru': (13404, 20097), 'es': (20097, 26790), 'de': (26790, 33483), 'fr': (33483, 40177), 'pt': (40177, 46879)}
def group_last(locale, group):
    s, e = blocks[locale]
    ind = 2 if group == 'desktop' else 4
    grp = None
    pat_start = re.compile(r'^\s{' + str(ind) + r'}"?' + group + r'"?: \{')
    pat_end = re.compile(r'^\s{' + str(ind) + r'}\}[;,]?$')
    for i in range(s-1, min(e, len(lines))):
        if pat_start.match(lines[i]):
            grp = i; break
    assert grp is not None, (locale, group, 'no group start')
    end = None
    for i in range(grp+1, min(e, len(lines))):
        if pat_end.match(lines[i]):
            end = i; break
    assert end is not None, (locale, group, 'no group end')
    keys = []
    for i in range(grp+1, end):
        m = re.match(r'^\s+"?([A-Za-z0-9_]+)"?\s*:', lines[i])
        if m: keys.append((i+1, m.group(1)))
    return grp+1, end+1, keys[-1] if keys else None, len(keys)
for group in ['desktop', 'tactics', 'auth']:
    print('==', group)
    for loc in blocks:
        try:
            gs, ge, last, n = group_last(loc, group)
            print('  %s: group@%d end@%d keys=%d last=%s' % (loc, gs, ge, n, last))
        except AssertionError as ex:
            print(' ', loc, 'FAIL', ex)
