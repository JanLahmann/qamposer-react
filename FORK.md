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
- **`feat/controlled-gates`** *(stacked on `feat/native-s-t-gates`)* —
  first-class controlled gates: CY, CZ, CH, CS, CT (control + target) and CCX
  (control + control2 + target). Editor renders control dots + vertical line
  (⊕ target for CNOT/CCX, lettered box otherwise), palette tiles + qubit
  editor, generic control-mask simulation, QASM `cy`/`cz`/`ch`/`ccx` +
  `cu1(pi/2)`/`cu1(pi/4)` for CS/CT. The JSON schema and QASM text match what
  Entangible's vision pipeline already emits (task #51 there).
- **`feat/palette-filter`** *(stacked on `feat/controlled-gates`)* —
  `gateTypes` prop on `Operations`/presets to restrict the visible palette
  (Entangible's golf mode unlocks gates round by round).
- **`feat/touch-placement`** *(stacked on `feat/palette-filter`)* — tap-to-place
  for touch devices (iOS drag needs an unusable long-press): tap a palette tile
  to arm, tap a wire to place; controlled gates collect control→target taps
  (CCX: three), with a pending indicator + hint line. Plus 44px coarse-pointer
  touch targets for tiles and the gate toolbar. Drag unchanged.

When an upstream release includes these, the corresponding merges can be dropped
and `entangible` re-based onto the new upstream `main`.
