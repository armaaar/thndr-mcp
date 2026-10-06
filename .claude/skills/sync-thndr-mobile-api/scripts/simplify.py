"""Fold hermes-dec register code into readable pseudo-JS, per Metro module.

usage: python -I simplify.py decompiled.js out_dir
Writes out_dir/simplified.js (all modules) and out_dir/modules.tsv (id, deps, exports).
"""
import re
import sys

src, out_dir = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8', errors='replace').read().split('\n')

FACTORY_RE = re.compile(r'^    r\d+ = function\(a0, a1, a2, a3, a4, a5, a6\)')
REG = re.compile(r"('(?:[^'\\]|\\.)*')|\b(r\d+|_closure\d+_slot\d+)\b")
MAXLEN = 600

# ---- pass 1: module boundaries, ids, deps, exports ----
modules = []  # (start, end, id, deps)
i = 0
n = len(lines)
while i < n:
    if FACTORY_RE.match(lines[i]):
        j = i + 1
        while j < n and lines[j] != '    };':
            j += 1
        mid = None
        deps = []
        k = j + 1
        m1 = re.match(r'^    r\d+ = (\d+);$', lines[k]) if k < n else None
        if m1:
            mid = int(m1.group(1))
            m2 = re.match(r'^    r\d+ = (\[.*\]|new Array\(0\));$', lines[k + 1])
            if m2 and m2.group(1).startswith('['):
                deps = [int(x) for x in re.findall(r'\d+', m2.group(1))]
        modules.append((i, j, mid, deps))
        i = j + 1
    else:
        i += 1

exports = {}
strs_by_mod = {}
for (s, e, mid, deps) in modules:
    names = []
    for ln in lines[s:e]:
        m = re.match(r"^        r\d+\['([A-Za-z_$][\w$]*)'\] = ", ln)
        if m and m.group(1) not in names and m.group(1) not in ('value',):
            names.append(m.group(1))
    exports[mid] = names

with open(out_dir + '/modules.tsv', 'w') as f:
    for (s, e, mid, deps) in modules:
        f.write('%s\t%d\t%s\t%s\n' % (mid, s + 1, ','.join(map(str, deps)), ','.join(exports.get(mid, [])[:40])))


def modlabel(mid):
    ex = exports.get(mid) or []
    ex = [x for x in ex if x not in ('default', '__esModule')]
    return 'M%s{%s}' % (mid, ','.join(ex[:5]) + (',..' if len(ex) > 5 else ''))


# ---- pass 2: fold ----
class State:
    def __init__(self, indent):
        self.regs = {}      # reg -> expr string
        self.pending = {}   # reg -> True if holds an unused call
        self.dirty = set()
        self.indent = indent


out = open(out_dir + '/simplified.js', 'w', encoding='utf-8')
tmp_counter = [0]


def process_module(s, e, mid, deps):
    aliases = {}  # closure slot -> expr (module-level only)
    out.write('\n// ===== module %s  (decompiled.js:%d)  deps=%s\n' % (mid, s + 1, deps))
    out.write('// exports: %s\n' % ','.join(exports.get(mid, [])[:60]))
    stack = [State('    ')]

    def emit(txt, ind=None):
        out.write((ind if ind is not None else stack[-1].indent + '    ') + txt + '\n')

    def sub(rhs, st, mark=True):
        def rep(m):
            if m.group(1):
                return m.group(1)
            r = m.group(2)
            if r.startswith('_closure'):
                return aliases.get(r, r)
            if r in st.regs:
                v = st.regs[r]
                if mark:
                    st.pending.pop(r, None)
                return v
            return r
        return REG.sub(rep, rhs)

    def paren(x):
        if re.match(r"^[\w$.\[\]'\"]+$", x) or re.match(r"^[\w$.]+\(.*\)$", x):
            return x
        return '(' + x + ')'

    def live(r, frm):
        pat = re.compile(r'\b' + r + r'\b')
        wpat = re.compile(r'^\s*' + r + r' = (.*);$')
        for k in range(frm, min(e, frm + 600)):
            l2 = lines[k]
            if 'function' in l2 and '{' in l2 and l2.rstrip().endswith(('{', 'environment: r0', 'environment: r1')) and re.search(r'= function', l2):
                # nested function: registers are local; skip quickly
                pass
            if pat.search(l2):
                w = wpat.match(l2)
                if w and not pat.search(w.group(1)):
                    return False
                return True
            if l2.strip() == '};' and len(l2) - len(l2.lstrip()) <= len(stack[-1].indent):
                return False
        return False

    def flush(st, all_dirty=True, drop=False):
        for r in sorted(st.pending):
            if not drop and not (all_dirty and live(r, cur_idx[0] + 1)):
                emit(st.regs[r] + ';')
        st.pending.clear()
        if drop:
            st.dirty.clear(); st.regs.clear()
            if hasattr(st, 'objs'):
                st.objs.clear()
            return
        if all_dirty:
            objs = getattr(st, 'objs', {})
            for r in sorted(st.dirty, key=lambda x: int(x[1:])):
                v = render_obj(st, r, None) if r in objs else st.regs.get(r)
                if v is not None and v != r and live(r, cur_idx[0] + 1):
                    emit('%s = %s;' % (r, v))
            st.dirty.clear()
            st.regs.clear()
            if hasattr(st, 'objs'):
                st.objs.clear()

    def setreg(st, r, v, is_call=False):
        if r in st.pending:
            emit(st.regs[r] + ';')
            st.pending.pop(r)
        if len(v) > MAXLEN:
            tmp_counter[0] += 1
            t = 't%d' % tmp_counter[0]
            emit('const %s = %s;' % (t, v))
            v = t
            is_call = False
        st.regs[r] = v
        st.dirty.add(r)
        if hasattr(st, 'objs'):
            st.objs.pop(r, None)
        if is_call:
            st.pending[r] = True

    def render_dep(expr):
        # a6[N] -> dep label
        m = re.fullmatch(r'a6\[(\d+)\]', expr)
        if m and int(m.group(1)) < len(deps):
            return 'dep:%d' % deps[int(m.group(1))]
        return None

    cur_idx = [s]
    for idx in range(s + 1, e):
        cur_idx[0] = idx
        ln = lines[idx]
        st = stack[-1]
        stripped = ln.strip()
        indent = ln[:len(ln) - len(ln.lstrip())]
        # function start
        fm = re.match(r'^(\s*)(r\d+) = (function\*?)\s*\(([^)]*)\) \{(?: // (.*))?$', ln)
        if fm:
            name = ''
            if fm.group(5):
                nm = re.search(r'Original name: ([^,]+)', fm.group(5))
                if nm:
                    name = nm.group(1)
            flush(st, all_dirty=False)
            emit('%s = %s %s(%s) {' % (fm.group(2), fm.group(3), name, fm.group(4)), fm.group(1))
            ns = State(fm.group(1))
            ns.fn_reg = fm.group(2)
            ns.fn_name = name or 'anon'
            stack.append(ns)
            continue
        if stripped == '};' and len(stack) > 1 and indent == st.indent:
            flush(st, drop=True)
            emit('};', indent)
            stack.pop()
            parent = stack[-1]
            setreg(parent, st.fn_reg, 'fn:' + st.fn_name)
            continue
        m = re.match(r'^(r\d+) = (.*);$', stripped)
        if m:
            r, rhs = m.group(1), m.group(2)
            # call: rA.bind(rB)(args)
            cm = re.match(r'^(r\d+)\.bind\((r\d+)\)\((.*)\)$', rhs)
            if cm:
                callee = sub_objs(cm.group(1), st, sub)
                this = sub_objs(cm.group(2), st, sub)
                args = sub_objs(cm.group(3), st, sub) if cm.group(3) else ''
                if callee.endswith('HermesInternal.concat'):
                    parts = [this] + ([a.strip() for a in split_args(args)] if args else [])
                    v = ' + '.join(parts)
                elif callee == 'a1' or callee.startswith('a1 ') or callee == 'require':
                    d = render_dep(args)
                    v = ('req(' + modlabel(int(d[4:])) + ')') if d else 'req(%s)' % args
                elif this in ('undefined',) or re.fullmatch(r'r\d+', this):
                    if callee.startswith('req(M1{') or callee.startswith('req(M') and 'interop' in callee:
                        v = args
                    else:
                        v = '%s(%s)' % (paren(callee), args)
                else:
                    if callee.startswith(this + '.') and callee.count('(') == this.count('('):
                        v = '%s(%s)' % (callee, args)
                    elif callee.startswith(this + '.'):
                        v = '%s(%s)' % (callee, args)
                    else:
                        v = '%s.call(%s%s)' % (paren(callee), this, (', ' + args) if args else '')
                setreg(st, r, v, is_call=True)
                continue
            om = re.match(r'^Object\.create\((r\d+), \{constructor: \{value: (r\d+)\}\}\)$', rhs)
            if om:
                setreg(st, r, '__this(%s)' % sub(om.group(2), st))
                continue
            nm2 = re.match(r'^new (r\d+)\[(r\d+)\]\((.*)\)$', rhs)
            if nm2:
                v = 'new %s(%s)' % (sub(nm2.group(2), st), sub_objs(nm2.group(3), st, sub) if nm2.group(3) else '')
                setreg(st, r, v, is_call=True)
                continue
            im = re.match(r'^(r\d+) instanceof Object \? (r\d+) : (r\d+)$', rhs)
            if im:
                a = sub(im.group(1), st)
                if a.startswith('new '):
                    setreg(st, r, a)
                    continue
            if rhs == '{}':
                setreg(st, r, '{}')
                st.regs[r] = {'obj': []}.__repr__() and '{}'
                st.objs = getattr(st, 'objs', {})
                st.objs[r] = []
                continue
            am = re.match(r'^new Array\((\d+)\)$', rhs)
            if am:
                setreg(st, r, '[]')
                st.objs = getattr(st, 'objs', {})
                st.objs[r] = 'arr'
                st.arrs = getattr(st, 'arrs', {})
                st.arrs[r] = [None] * int(am.group(1))
                continue
            # object/array rendering on read
            v = sub_objs(rhs, st, sub)
            setreg(st, r, v)
            continue
        pm = re.match(r"^(r\d+)\[('(?:[^'\\]|\\.)*'|\d+|r\d+)\] = (r\d+);$", stripped) or \
            re.match(r"^(r\d+)\.([\w$]+) = (r\d+);$", stripped)
        if pm:
            tgt, key, val = pm.group(1), pm.group(2), pm.group(3)
            vexpr = sub_objs(val, st, sub)
            objs = getattr(st, 'objs', {})
            if tgt in objs and objs[tgt] != 'arr' and isinstance(objs[tgt], list):
                k = key.strip("'") if key.startswith("'") else ('[' + sub(key, st) + ']')
                objs[tgt].append((k, vexpr))
                continue
            if tgt in objs and objs[tgt] == 'arr' and key.isdigit():
                arr = st.arrs[tgt]
                ki = int(key)
                if ki < len(arr):
                    arr[ki] = vexpr
                    continue
            t = sub(tgt, st)
            k = key.strip("'") if key.startswith("'") else key
            if key.startswith("'") and re.fullmatch(r'[A-Za-z_$][\w$]*', k):
                emit('%s.%s = %s;' % (t, k, vexpr))
            else:
                emit('%s[%s] = %s;' % (t, sub(key, st) if not key.startswith("'") else key, vexpr))
            continue
        vm = re.match(r'^var (_closure\d+_slot\d+) = (r\d+);$', stripped)
        if vm:
            slot, rr = vm.group(1), vm.group(2)
            v = sub_objs(rr, st, sub)
            if len(stack) == 1 and (re.fullmatch(r'a\d', v) or v.startswith('req(')):
                aliases[slot] = v
                continue
            emit('var %s = %s;' % (slot, v))
            continue
        am2 = re.match(r'^(_closure\d+_slot\d+) = (r\d+);$', stripped)
        if am2:
            emit('%s = %s;' % (am2.group(1), sub_objs(am2.group(2), st, sub)))
            continue
        # control flow / other
        if stripped.startswith('case ') or stripped.startswith('_fun') or stripped == '}' or stripped.startswith('switch'):
            flush(st)
            if stripped.startswith('case '):
                out.write(ln + '\n')
            elif stripped.startswith('_fun'):
                emit(stripped, indent)
            else:
                emit(stripped, indent)
            continue
        if stripped.startswith('if(') or stripped.startswith('return ') or stripped.startswith('throw '):
            txt = sub_objs_line(stripped, st, sub)
            if stripped.startswith('if('):
                flush(st)
                emit(txt, indent)
            else:
                flush(st, all_dirty=False)
                emit(txt, indent)
                flush(st, drop=True)
            continue
        if re.search(r'_ip = \d+; continue', stripped):
            flush(st)
            emit(stripped, indent)
            continue
        emit(sub(stripped, st), indent)
    flush(stack[-1])


def split_args(args):
    res, depth, cur, q = [], 0, '', False
    i = 0
    while i < len(args):
        c = args[i]
        if q:
            cur += c
            if c == '\\':
                cur += args[i + 1]
                i += 1
            elif c == "'":
                q = False
        elif c == "'":
            q = True
            cur += c
        elif c in '([{':
            depth += 1
            cur += c
        elif c in ')]}':
            depth -= 1
            cur += c
        elif c == ',' and depth == 0:
            res.append(cur)
            cur = ''
        else:
            cur += c
        i += 1
    if cur.strip():
        res.append(cur)
    return res


def render_obj(st, r, sub):
    o = st.objs[r]
    if o == 'arr':
        items = st.arrs[r]
        return '[' + ', '.join('?' if x is None else x for x in items) + ']'
    parts = []
    for k, v in o:
        parts.append('%s: %s' % (k, v))
    return '{' + ', '.join(parts) + '}'


def sub_objs(rhs, st, sub):
    objs = getattr(st, 'objs', {})
    if objs:
        def rep(m):
            if m.group(1):
                return m.group(1)
            r = m.group(2)
            if r in objs:
                return render_obj(st, r, sub)
            return m.group(0)
        rhs = REG.sub(rep, rhs)
    return sub(rhs, st)


def sub_objs_line(line, st, sub):
    return sub_objs(line, st, sub)


for (s, e, mid, deps) in modules:
    try:
        process_module(s, e, mid, deps)
    except Exception as ex:  # keep going
        out.write('// !! simplify error in module %s: %r\n' % (mid, ex))
out.close()
print('modules', len(modules))
