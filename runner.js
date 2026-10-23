// Python side of PyLab. This source is written into the Pyodide file system as
// /pylab/_pylab.py and imported once per runtime. (No backticks allowed below.)
window.PYLAB_RUNNER_PY = String.raw`
"""PyLab cell runner: executes notebook cells inside Pyodide, Colab style."""
import sys, os, io, ast, json, base64, builtins, linecache, time, traceback
import types, importlib, importlib.util, functools

os.environ["MPLBACKEND"] = "agg"
os.environ["SCIKIT_LEARN_DATA"] = "/pylab/sklearn_data"
os.environ["MPLCONFIGDIR"] = "/pylab/mplconfig"

import js

try:
    from pyodide.ffi import run_sync, can_run_sync
except ImportError:  # very old Pyodide
    run_sync = None

    def can_run_sync():
        return False

_B = js.pylabBridge          # captured once: a restarted runtime gets a new bridge
_MAIN = sys.modules["__main__"]
_MAX_OUT = 200_000           # characters of output kept per cell
_YIELD_EVERY = 0.05          # seconds between UI yields (interactive mode)
_FIG_DPI = 150               # PNG resolution; the page shows it at 100 dpi size
_URL_MAP = {
    "archive.ics.uci.edu/ml/machine-learning-databases/iris/iris.data": "/pylab/data/iris.data",
}
_PYPI_NAMES = {
    "sklearn": "scikit-learn", "PIL": "pillow", "cv2": "opencv-python",
    "bs4": "beautifulsoup4", "yaml": "pyyaml", "skimage": "scikit-image",
}


class TimeLimitInterrupt(KeyboardInterrupt):
    pass


TimeLimitInterrupt.__module__ = "builtins"   # print it without the "_pylab." prefix


class _State:
    jspi = False
    time_limit = 0.0
    deadline = None
    last_yield = 0.0
    out_chars = 0
    truncated = False
    tail = ""
    ticks = 0
    patched = set()


_S = _State()


# ----------------------------------------------------------------- output streams
class _Stream(io.TextIOBase):
    def __init__(self, name):
        self._name = name

    @property
    def encoding(self):
        return "utf-8"

    def writable(self):
        return True

    def isatty(self):
        return False

    def flush(self):
        pass

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        n = len(s)
        if not s:
            return 0
        _S.tail = (_S.tail + s)[-600:]
        if _S.truncated:
            return n
        room = _MAX_OUT - _S.out_chars
        if n > room:
            s = s[:max(room, 0)]
            _S.truncated = True
        _S.out_chars += len(s)
        if s:
            _B.stream(self._name, s)
        if _S.truncated:
            _B.stream("stderr", "\n[Output truncated: more than %d characters]\n" % _MAX_OUT)
        return n


# --------------------------------------------- loop guard: stop button / time limit
def _check():
    now = time.monotonic()
    if _S.deadline is not None and now > _S.deadline:
        _S.deadline = None
        raise TimeLimitInterrupt(
            "Execution stopped after %g s (possible infinite loop). "
            "You can change the limit in Runtime > Settings." % _S.time_limit)
    if _S.jspi and now - _S.last_yield > _YIELD_EVERY:
        run_sync(_B.yieldNow())        # lets the page repaint and the Stop button work
        _S.last_yield = time.monotonic()
    if _B.stopRequested():
        raise KeyboardInterrupt()


_MON = getattr(sys, "monitoring", None)
_TOOL = 4


def _on_jump(code, src, dst):
    if not code.co_filename.startswith("<cell-"):
        return _MON.DISABLE            # never pay again for library loops
    _S.ticks += 1
    if _S.ticks >= 64:
        _S.ticks = 0
        _check()


def _trace_local(frame, event, arg):
    if event == "line":
        _S.ticks += 1
        if _S.ticks >= 64:
            _S.ticks = 0
            _check()
    return _trace_local


def _trace_global(frame, event, arg):
    if frame.f_code.co_filename.startswith("<cell-"):
        return _trace_local
    return None


if _MON is not None:
    try:
        _MON.use_tool_id(_TOOL, "pylab")
        _MON.register_callback(_TOOL, _MON.events.JUMP, _on_jump)
    except Exception:
        _MON = None


def _guard_on():
    if _MON is not None:
        _MON.set_events(_TOOL, _MON.events.JUMP)
    else:
        sys.settrace(_trace_global)


def _guard_off():
    if _MON is not None:
        _MON.set_events(_TOOL, 0)
    else:
        sys.settrace(None)


# ----------------------------------------------------------- input() and sleep()
def _input(prompt=""):
    prompt = "" if prompt is None else str(prompt)
    t0 = time.monotonic()
    if can_run_sync():
        value = run_sync(_B.requestInput(prompt))
    else:
        value = _B.promptInput(_S.tail[-400:], prompt)
    if _S.deadline is not None:
        _S.deadline += time.monotonic() - t0
    if value is None:
        raise KeyboardInterrupt("input cancelled")
    value = str(value)
    sys.stdout.write(prompt + value + "\n")
    return value


_real_sleep = time.sleep


def _sleep(seconds):
    if seconds > 0 and can_run_sync():
        run_sync(_B.sleep(float(seconds) * 1000))
        _S.last_yield = time.monotonic()
        if _B.stopRequested():
            raise KeyboardInterrupt()
    else:
        _real_sleep(seconds)


# ------------------------------------------------------------- rich display
def _mime_bundle(obj):
    data = {}
    try:
        import matplotlib.figure
        if isinstance(obj, matplotlib.figure.Figure):
            data["image/png"] = _fig_png(obj)
            if "matplotlib.pyplot" in sys.modules:   # don't show it a second time
                sys.modules["matplotlib.pyplot"].close(obj)
    except ImportError:
        pass
    if not isinstance(obj, type):
        for meth, mime in (("_repr_png_", "image/png"), ("_repr_jpeg_", "image/jpeg"),
                           ("_repr_svg_", "image/svg+xml"), ("_repr_html_", "text/html"),
                           ("_repr_markdown_", "text/markdown")):
            fn = getattr(obj, meth, None)
            if callable(fn) and mime not in data:
                try:
                    val = fn()
                except Exception:
                    val = None
                if val is None:
                    continue
                if isinstance(val, tuple):
                    val = val[0]
                if isinstance(val, bytes):
                    val = base64.b64encode(val).decode()
                data[mime] = val
    try:
        data["text/plain"] = repr(obj)
    except Exception as e:
        data["text/plain"] = "<repr failed: %r>" % e
    return data


def display(*objs, **kwargs):
    for obj in objs:
        _B.display(json.dumps(_mime_bundle(obj)), False)


def _clear_output(wait=False):
    _B.clearOutput()


def _make_ipython_stub():
    ip = types.ModuleType("IPython")
    ipd = types.ModuleType("IPython.display")

    class HTML:
        def __init__(self, data=None, filename=None, url=None):
            self.data = open(filename).read() if filename else (data or "")

        def _repr_html_(self):
            return self.data

    class Markdown:
        def __init__(self, data=None, filename=None, url=None):
            self.data = open(filename).read() if filename else (data or "")

        def _repr_markdown_(self):
            return self.data

    class Image:
        def __init__(self, data=None, filename=None, url=None, format=None, **kw):
            if filename is None and isinstance(data, str) and os.path.exists(data):
                filename, data = data, None
            if filename:
                with open(filename, "rb") as f:
                    data = f.read()
                format = format or filename.rsplit(".", 1)[-1].lower()
            self.data, self.format = data, (format or "png")

        def _repr_png_(self):
            return self.data if self.format == "png" else None

        def _repr_jpeg_(self):
            return self.data if self.format in ("jpg", "jpeg") else None

    for name, val in (("display", display), ("clear_output", _clear_output),
                      ("HTML", HTML), ("Markdown", Markdown), ("Image", Image)):
        setattr(ipd, name, val)
    ip.display = ipd
    ip.get_ipython = lambda: None
    sys.modules["IPython"] = ip
    sys.modules["IPython.display"] = ipd


# --------------------------------------------------------------- matplotlib
def _fig_png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=_FIG_DPI, bbox_inches="tight")
    return base64.b64encode(buf.getvalue()).decode()


def _figure_bundle(fig):
    w, h = fig.get_size_inches() * fig.dpi
    return {"image/png": _fig_png(fig),
            "text/plain": "<Figure size %dx%d with %d Axes>" % (w, h, len(fig.axes))}


def _show(*args, **kwargs):
    if "matplotlib.pyplot" not in sys.modules:
        return
    plt = sys.modules["matplotlib.pyplot"]
    for num in plt.get_fignums():
        fig = plt.figure(num)
        if not (fig.axes or fig.texts or fig.images or fig.patches or fig.lines):
            continue
        _B.display(json.dumps(_figure_bundle(fig)), False)
    plt.close("all")


def _figure_show(self, *args, **kwargs):
    _B.display(json.dumps(_figure_bundle(self)), False)


# -------------------------------------------------- library integration hooks
def _fix_source(src):
    if isinstance(src, str) and src.startswith(("http://", "https://")):
        for key, local in _URL_MAP.items():
            if key in src and os.path.exists(local):
                return local
        if src.startswith("http://"):
            return "https://" + src[7:]   # browsers block plain http from https pages
    return src


def _wrap_reader(fn):
    @functools.wraps(fn)
    def reader(*args, **kwargs):
        if args:
            args = (_fix_source(args[0]),) + args[1:]
        for key in ("filepath_or_buffer", "io", "path_or_buf"):
            if key in kwargs:
                kwargs[key] = _fix_source(kwargs[key])
        return fn(*args, **kwargs)
    return reader


def _prepare(code):
    if "mpl" not in _S.patched and importlib.util.find_spec("matplotlib"):
        import matplotlib
        matplotlib.use("agg")
        import matplotlib.pyplot as plt
        import matplotlib.figure
        plt.show = _show
        matplotlib.figure.Figure.show = _figure_show
        _S.patched.add("mpl")
    if "pd" not in _S.patched and importlib.util.find_spec("pandas"):
        import pandas as pd
        for name in ("read_csv", "read_table", "read_excel", "read_json", "read_html"):
            if hasattr(pd, name):
                setattr(pd, name, _wrap_reader(getattr(pd, name)))
        _S.patched.add("pd")
    if "fetch_california_housing" in code:
        _ensure_california_housing()


def _ensure_california_housing():
    """Write sklearn's cache file from the bundled archive (no internet needed)."""
    home = os.environ["SCIKIT_LEARN_DATA"]
    path = os.path.join(home, "cal_housing_py3.pkz")
    if os.path.exists(path):
        return
    import tarfile
    import numpy as np
    import joblib
    os.makedirs(home, exist_ok=True)
    raw = base64.b64decode(str(js.PYLAB_DATASETS.calHousingTgz))
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        member = tar.extractfile("CaliforniaHousing/cal_housing.data")
        cal = np.loadtxt(member, delimiter=",")
    cal = cal[:, [8, 7, 2, 3, 4, 5, 6, 1, 0]]   # same column order sklearn stores
    joblib.dump(cal, path, compress=6)


def missing_modules(code):
    """Top-level modules imported by code that are neither installed nor in stdlib."""
    from pyodide.code import find_imports
    try:
        names = find_imports(code)
    except SyntaxError:
        return []
    out = []
    for name in names:
        top = name.split(".")[0]
        if top in sys.stdlib_module_names or top in sys.modules or top in out:
            continue
        if importlib.util.find_spec(top) is None:
            out.append(top)
    return out


# Newest releases of these need a newer scipy/numpy than Pyodide ships.
_PINS = {"mlxtend": "mlxtend==0.23.4"}


def pypi_name(module):
    return _PYPI_NAMES.get(module, module)


def pinned(requirement):
    return _PINS.get(requirement.lower(), requirement)


# ---------------------------------------------------------------- run a cell
def _report_error(exc):
    tb = exc.__traceback__
    cur = tb
    while cur is not None and not cur.tb_frame.f_code.co_filename.startswith("<cell-"):
        cur = cur.tb_next
    if cur is not None:
        tb = cur
    if isinstance(exc, SyntaxError):
        lines = traceback.format_exception_only(type(exc), exc)
    elif isinstance(exc, KeyboardInterrupt) and cur is None:
        lines = ["%s: %s\n" % (type(exc).__name__, exc) if str(exc) else "KeyboardInterrupt\n"]
    else:
        te = traceback.TracebackException(type(exc), exc, tb)
        te.stack = traceback.StackSummary.from_list(
            [f for f in te.stack if f.filename != __file__])   # hide PyLab's own frames
        lines = list(te.format())
    hint = ""
    if isinstance(exc, FileNotFoundError):
        hint = ("\nHint: upload the file first with the Files panel on the left "
                "(files are kept only while this page is open).")
    elif isinstance(exc, ModuleNotFoundError):
        hint = ("\nHint: this library could not be installed in the browser. "
                "Only pure-Python packages and the Pyodide package set are available.")
    _B.error(type(exc).__name__, str(exc), "".join(lines) + hint)


def run_cell(code, cell_number, time_limit=0):
    _S.jspi = bool(can_run_sync())
    _S.time_limit = float(time_limit or 0)
    _S.out_chars, _S.truncated, _S.tail, _S.ticks = 0, False, "", 0
    filename = "<cell-%d>" % cell_number
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    status = "ok"
    old_out, old_err = sys.stdout, sys.stderr
    try:
        _prepare(code)
    except Exception as e:  # never block the cell because of a hook
        print("PyLab hook warning:", e, file=sys.__stderr__)
    sys.stdout, sys.stderr = _Stream("stdout"), _Stream("stderr")
    _S.deadline = (time.monotonic() + _S.time_limit) if _S.time_limit > 0 else None
    _S.last_yield = time.monotonic()
    try:
        tree = ast.parse(code, filename, "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr) and not code.rstrip().endswith(";"):
            last = ast.Expression(tree.body.pop().value)
        value = None
        _guard_on()
        try:
            exec(compile(tree, filename, "exec"), _MAIN.__dict__)
            if last is not None:
                value = eval(compile(last, filename, "eval"), _MAIN.__dict__)
        finally:
            _guard_off()
        if value is not None:
            _MAIN.__dict__["_"] = value
            _B.display(json.dumps(_mime_bundle(value)), True)
    except SystemExit as e:
        if e.code not in (None, 0):
            _report_error(e)
            status = "error"
    except BaseException as e:
        _report_error(e)
        status = "error"
    finally:
        try:
            _show()
        except Exception as e:
            _report_error(e)
        sys.stdout, sys.stderr = old_out, old_err
        _S.deadline = None
    return status


def detect_jspi():
    return bool(can_run_sync())


def reset_namespace():
    """Soft restart: forget user variables, keep installed libraries."""
    keep = {"__name__", "__doc__", "__builtins__", "__loader__", "__spec__", "__package__"}
    for key in list(_MAIN.__dict__):
        if key not in keep:
            del _MAIN.__dict__[key]
    if "matplotlib.pyplot" in sys.modules:
        sys.modules["matplotlib.pyplot"].close("all")


def list_variables():
    rows = []
    for name, val in list(_MAIN.__dict__.items()):
        if name.startswith("_") or isinstance(val, (types.ModuleType, type, types.FunctionType,
                                                     types.BuiltinFunctionType)):
            continue
        typ = type(val).__name__
        shape = getattr(val, "shape", None)
        if isinstance(shape, tuple):
            size = " x ".join(str(s) for s in shape)
        elif hasattr(val, "__len__") and not isinstance(val, (int, float)):
            try:
                size = str(len(val))
            except Exception:
                size = ""
        else:
            size = ""
        try:
            if typ in ("DataFrame", "Series", "ndarray") and size:
                text = "%s (%s)" % (typ, size)
            else:
                text = repr(val)
        except Exception:
            text = "?"
        rows.append({"name": name, "type": typ, "size": size, "value": text[:120]})
    return json.dumps(rows)


def _setup():
    builtins.input = _input
    builtins.display = display
    time.sleep = _sleep
    _make_ipython_stub()
    os.makedirs(os.environ["MPLCONFIGDIR"], exist_ok=True)
    try:
        import pyodide_http
        pyodide_http.patch_all()       # urllib / requests work for CORS-enabled URLs
    except Exception:
        pass
    os.chdir("/home/pyodide")


_setup()
`;
