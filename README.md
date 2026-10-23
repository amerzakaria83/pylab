# NGN 112 PyLab

A Colab-style Python notebook for NGN 112 that runs entirely in the student's
browser (Python 3.13 compiled to WebAssembly by [Pyodide](https://pyodide.org) 0.28.3).
There's no server to run and nothing to install, and student code never leaves their computer.

## Libraries (taken from the lecture slides)

| Library | Used in | How it's provided |
|---|---|---|
| `numpy` | Lectures 4–7 | Built in (Pyodide) |
| `pandas` | Lectures 4–7 | Built in |
| `matplotlib.pyplot` | Lectures 4–7 | Built in, figures shown inline |
| `seaborn` | Lectures 5–6 | Installed from PyPI on first import |
| `scikit-learn` (`preprocessing`, `model_selection`, `linear_model`, `svm`, `neighbors`, `naive_bayes`, `tree`, `neural_network`, `metrics`, `datasets`) | Lectures 5–7 | Built in |
| `mlxtend.plotting` | Lecture 6 | Installed from PyPI on first import (pinned to 0.23.4) |
| `math`, `statistics`, `random`, `time` | Lectures 2–3 | Python standard library |

Bundled datasets: `iris.data` and `student_scores.csv` appear in the Files panel.
`fetch_california_housing()` works offline. `pd.read_csv('http://archive.ics.uci.edu/.../iris.data')`
is redirected to the bundled copy.

## Features

- Code and text (Markdown + LaTeX) cells, with shared variables across cells and an execution count.
- Live output, inline `input()` boxes, and a Stop button. These need Chrome or Edge 137+ (JSPI).
  Other browsers fall back to pop-up `input()` and a time limit on each cell (Runtime → Settings).
- The last expression is displayed automatically (DataFrames show as tables). Plots appear without `plt.show()`.
- `!pip install <pure-python package>` and `%matplotlib inline` work as they do in Colab.
- Files panel (upload, drag and drop, download, delete) and a Variables panel.
- Autosaves to the browser. Download or open `.ipynb`, which is compatible with Google Colab and Jupyter.
- An example notebook for each lecture (Examples menu).

## Publishing on GitHub Pages

The folder is a static website, so it can go on any web host. These steps use GitHub Pages, which is free.

### Option A: upload in the browser (no Git needed)

1. Sign in at https://github.com (create a free account if needed).
2. Click **+** (top right) → **New repository**.
   - Name: `pylab` (the name becomes part of the link).
   - Visibility: **Public**. Free accounts can only publish Pages from public repositories.
   - Leave "Add a README" unchecked → **Create repository**.
3. On the empty repository page, click **uploading an existing file**.
4. Drag in **all files inside this `PyLab` folder**: `index.html`, `app.js`, `runner.js`, `examples.js`,
   `datasets.js`, `style.css`, `README.md` and `.nojekyll`. Drag the files themselves, not the folder.
   `.nojekyll` is optional, so skip it if your file browser hides it.
5. Click **Commit changes**.
6. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**,
   **Branch: main**, folder **/ (root)**, then click **Save**.
7. After one or two minutes the page shows **"Your site is live at https://<username>.github.io/pylab/"**.
   Open it and run a cell to check it works.

To update later (for example, after editing `examples.js`), open the repository, click **Add file → Upload files**,
drop in the changed files and commit. The site updates within a couple of minutes. Tell students to refresh
with **Ctrl+F5** if they still see the old version.

### Option B: Git on the command line

Run these in this `PyLab` folder, after creating an empty public repository named `pylab` as in step 2 above:

```
git init -b main
git config user.name "Your Name"
git config user.email "you@example.com"
git add .
git commit -m "Publish NGN 112 PyLab"
git remote add origin https://github.com/<username>/pylab.git
git push -u origin main
```

Then turn on Pages as in step 6. Later updates are `git add .`, `git commit -m "..."` and `git push`.

### Links to share with students

- Main page: `https://<username>.github.io/pylab/`

Direct links:

- `https://<username>.github.io/pylab/?example=numpy-pandas` opens a lecture example. Keys: `python-basics`, `decisions-loops`,
  `numpy-pandas`, `visualization`, `classification-regression`, `neural-networks`.
- `https://<username>.github.io/pylab/?nb=https://raw.githubusercontent.com/.../lab1.ipynb` opens your own notebook from a URL.

To try it locally, run this from the `PDF` folder and open http://localhost:8765:

```
python -m http.server 8765 --directory PyLab
```

The first visit downloads about 30–60 MB of Python and libraries from the jsDelivr CDN. The browser caches it after that.

## Files

- `index.html`, `style.css`: the page
- `app.js`: notebook UI, runtime management, files, saving and `.ipynb` import and export
- `runner.js`: the Python cell runner that executes inside Pyodide
- `examples.js`: lecture example notebooks, which you can edit to add your own
- `datasets.js`: bundled datasets (generated)
