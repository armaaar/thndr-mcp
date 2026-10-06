"""List every HTTP call site in simplified.js (from simplify.py): line, module, enclosing function, client.method(args).

    python3 -I list-calls.py <simplified.js> > calls.tsv
"""
import re, sys
S = sys.argv[1]
mod = None; fnstack = []
pat = re.compile(r"\.(thndrApi|apiGateway|serverlessApi|thndrPayAuthorizedApi|thndrPayNonAuthorizedApi|httpClient)\.(get|post|patch|put|delete|request)\((.{0,300})")
seen = set()
for no, ln in enumerate(open(S, encoding='utf-8', errors='replace'), 1):
    if ln.startswith('// ===== module'):
        mod = ln.split()[3]; fnstack = []
        continue
    m = re.match(r'^(\s*)r\d+ = function\*? (\S*)\(', ln)
    if m:
        ind = len(m.group(1))
        fnstack = [f for f in fnstack if f[0] < ind]
        if m.group(2) and not m.group(2).startswith('?anon'):
            fnstack.append((ind, m.group(2)))
        continue
    for c in pat.finditer(ln):
        key = (mod, c.group(1), c.group(2), c.group(3)[:200])
        if key in seen: continue
        seen.add(key)
        fn = '/'.join(f[1] for f in fnstack[-2:])
        print('%s\tM%s\t%s\t%s.%s(%s' % (no, mod, fn, c.group(1), c.group(2), c.group(3)[:260].rstrip()))
