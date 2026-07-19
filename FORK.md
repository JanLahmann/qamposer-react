# Fork notes

This is a fork of [QAMP-62/qamposer-react](https://github.com/QAMP-62/qamposer-react).

## The `entangible` branch

`entangible` is the **integration branch** consumed by the
[Entangible](https://github.com/JanLahmann/entangible) project as an npm git
dependency. It tracks upstream `main` and layers on the small features Entangible
needs ahead of an upstream release.

To keep git-dependency installs working, this branch adds a `prepare` script
(`npm run build`) so `dist/` is built automatically when the package is installed
from git (upstream publishes `dist/` only to npm, not to the repository).

## Features offered upstream

Each feature lives on its own branch off upstream `main` and is merged here. They
are intended to be offered to the upstream maintainer as self-contained PRs; this
branch simply carries them until they land upstream.

- **`feat/native-s-t-gates`** — native `S` and `T` phase gate types (Entangible has
  physical S/T tiles that otherwise emit `RZ` equivalents).
- **`fix/qasm-format-parameter-zero`** — guard `formatParameter` so near-zero
  rotation angles never emit an empty QASM parameter.

When an upstream release includes these, the corresponding merges can be dropped
and `entangible` re-based onto the new upstream `main`.
