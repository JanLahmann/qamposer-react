import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, createEvent } from '@testing-library/react';
import { QamposerMicro } from '../presets/QamposerMicro';
import { noopAdapter } from '../adapters/noop';
import type { Circuit, Gate, GateType } from '../types';

/**
 * Tap-to-place (touch) placement.
 *
 * happy-dom reports a zero-origin `getBoundingClientRect()` and no scrolling,
 * so a tap's `clientX` equals the canvas X the editor snaps on. With the
 * default 32px columns, 20px gaps and a 16px left margin the column centres are
 * 32, 84, 136, … — the constants used below.
 */
const COLUMN_CENTER = [32, 84, 136, 188];
const QUBIT_HEIGHT = 80;

/** Controlled palette tiles are SVG icons, identified by their tooltip. */
const CONTROLLED_TITLES: Partial<Record<GateType, string>> = {
  CNOT: 'Controlled-NOT',
  CY: 'Controlled-Y',
  CZ: 'Controlled-Z',
  CH: 'Controlled-H',
  CS: 'Controlled-S',
  CT: 'Controlled-T',
  CCX: 'Toffoli (CCX)',
};

function setup(circuit: Circuit) {
  const onCircuitChange = vi.fn();
  const { container } = render(
    <QamposerMicro
      adapter={noopAdapter}
      defaultCircuit={circuit}
      onCircuitChange={onCircuitChange}
    />
  );
  // The multi-qubit section starts collapsed.
  container.querySelectorAll('.operations__section-header').forEach((header) => {
    if (!header.parentElement?.querySelector('.operations__grid')) fireEvent.click(header);
  });
  return { container, onCircuitChange };
}

function paletteTile(container: HTMLElement, type: GateType): HTMLElement {
  const tiles = Array.from(container.querySelectorAll<HTMLElement>('.operations__gate'));
  const byLabel = tiles.find(
    (tile) => tile.querySelector('.operations__gate-label')?.textContent === type
  );
  if (byLabel) return byLabel;
  // Controlled tiles are SVG icons; a disabled one swaps its tooltip for the
  // "<type> requires at least N qubits" message.
  return tiles.find((tile) => {
    const title = tile.getAttribute('title') ?? '';
    return title === CONTROLLED_TITLES[type] || title.startsWith(`${type} requires`);
  })!;
}

function arm(container: HTMLElement, type: GateType) {
  fireEvent.click(paletteTile(container, type));
}

function isArmed(container: HTMLElement, type: GateType) {
  const tile = paletteTile(container, type);
  return (
    tile.classList.contains('operations__gate--armed') &&
    tile.getAttribute('aria-pressed') === 'true'
  );
}

function tapWire(container: HTMLElement, qubit: number, clientX: number) {
  const zones = container.querySelectorAll('.circuit-editor__drop-zone-continuous');
  fireEvent.click(zones[qubit], { clientX });
}

function hintText(container: HTMLElement): string | null {
  return container.querySelector('.circuit-editor__touch-hint')?.textContent ?? null;
}

/** Gates of the most recent circuit emitted by the provider. */
function placedGates(onCircuitChange: ReturnType<typeof vi.fn>): Gate[] {
  const calls = onCircuitChange.mock.calls;
  return (calls[calls.length - 1][0] as Circuit).gates;
}

/** Compact `[type, position, qubit-or-roles]` view used in assertions. */
function summarize(gates: Gate[]) {
  return gates.map((g) => ({
    type: g.type,
    position: g.position,
    ...(g.qubit !== undefined ? { qubit: g.qubit } : {}),
    ...(g.control !== undefined ? { control: g.control } : {}),
    ...(g.control2 !== undefined ? { control2: g.control2 } : {}),
    ...(g.target !== undefined ? { target: g.target } : {}),
  }));
}

describe('tap-to-place: arming the palette', () => {
  it('arms a tile on tap and shows the hint', () => {
    const { container } = setup({ qubits: 2, gates: [] });

    expect(isArmed(container, 'H')).toBe(false);
    expect(hintText(container)).toBeNull();

    arm(container, 'H');

    expect(isArmed(container, 'H')).toBe(true);
    expect(hintText(container)).toBe('Tap a wire to place H');
  });

  it('disarms when the same tile is tapped again', () => {
    const { container } = setup({ qubits: 2, gates: [] });

    arm(container, 'H');
    arm(container, 'H');

    expect(isArmed(container, 'H')).toBe(false);
    expect(hintText(container)).toBeNull();
  });

  it('switches the armed gate when another tile is tapped', () => {
    const { container } = setup({ qubits: 2, gates: [] });

    arm(container, 'H');
    arm(container, 'X');

    expect(isArmed(container, 'H')).toBe(false);
    expect(isArmed(container, 'X')).toBe(true);
    expect(hintText(container)).toBe('Tap a wire to place X');
  });

  it('cannot arm a controlled gate the register is too small for', () => {
    const { container } = setup({ qubits: 2, gates: [] }); // CCX needs 3

    const ccx = paletteTile(container, 'CCX');
    expect(ccx.classList.contains('operations__gate--disabled')).toBe(true);

    fireEvent.click(ccx);

    expect(isArmed(container, 'CCX')).toBe(false);
    expect(hintText(container)).toBeNull();
  });
});

describe('tap-to-place: single-qubit gates', () => {
  const withH: Circuit = {
    qubits: 2,
    gates: [{ id: 'h0', type: 'H', qubit: 1, position: 0 }],
  };

  it('places on the tapped wire at the snapped column', () => {
    const { container, onCircuitChange } = setup(withH);

    arm(container, 'X');
    tapWire(container, 1, COLUMN_CENTER[1]);

    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'H', position: 0, qubit: 1 },
      { type: 'X', position: 1, qubit: 1 },
    ]);
  });

  it('snaps to an earlier column and shifts the existing gate right', () => {
    const { container, onCircuitChange } = setup(withH);

    arm(container, 'X');
    tapWire(container, 1, COLUMN_CENTER[0]);

    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'X', position: 0, qubit: 1 },
      { type: 'H', position: 1, qubit: 1 },
    ]);
  });

  it('disarms after placing (one-shot)', () => {
    const { container } = setup({ qubits: 2, gates: [] });

    arm(container, 'H');
    tapWire(container, 0, COLUMN_CENTER[0]);

    expect(isArmed(container, 'H')).toBe(false);
    expect(hintText(container)).toBeNull();
  });

  it('gives rotation gates the same default parameter as a drop', () => {
    const { container, onCircuitChange } = setup({ qubits: 2, gates: [] });

    arm(container, 'RZ');
    tapWire(container, 0, COLUMN_CENTER[0]);

    expect(placedGates(onCircuitChange)[0].parameter).toBeCloseTo(Math.PI / 2);
  });

  it('does nothing when no gate is armed', () => {
    const { container, onCircuitChange } = setup({ qubits: 2, gates: [] });

    tapWire(container, 0, COLUMN_CENTER[0]);

    expect(onCircuitChange).not.toHaveBeenCalled();
  });
});

describe('tap-to-place: controlled gates', () => {
  const withX: Circuit = {
    qubits: 3,
    gates: [{ id: 'x0', type: 'X', qubit: 0, position: 0 }],
  };

  it('takes the control on the first tap and the target on the second', () => {
    const { container, onCircuitChange } = setup(withX);

    arm(container, 'CNOT');
    tapWire(container, 0, COLUMN_CENTER[1]);

    // Nothing placed yet — a pending control dot and the "target" hint instead.
    expect(onCircuitChange).not.toHaveBeenCalled();
    const pending = container.querySelector('.circuit-editor__controlled--pending');
    expect(pending).toBeInTheDocument();
    expect((pending as HTMLElement).style.left).toBe(`${COLUMN_CENTER[1]}px`);
    expect(pending!.querySelectorAll('.circuit-editor__controlled-control')).toHaveLength(1);
    expect(pending!.querySelector('.circuit-editor__controlled-target')).toBeNull();
    expect(hintText(container)).toBe('Tap the target wire');

    // Second tap deliberately at another column: the first tap locked it.
    tapWire(container, 2, COLUMN_CENTER[0]);

    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'X', position: 0, qubit: 0 },
      { type: 'CNOT', position: 1, control: 0, target: 2 },
    ]);
    expect(isArmed(container, 'CNOT')).toBe(false);
    expect(container.querySelector('.circuit-editor__controlled--pending')).toBeNull();
  });

  it('ignores a second tap on the control wire', () => {
    const { container, onCircuitChange } = setup(withX);

    arm(container, 'CNOT');
    tapWire(container, 1, COLUMN_CENTER[0]);
    tapWire(container, 1, COLUMN_CENTER[0]);

    expect(onCircuitChange).not.toHaveBeenCalled();
    expect(hintText(container)).toBe('Tap the target wire');
    expect(
      container.querySelectorAll(
        '.circuit-editor__controlled--pending .circuit-editor__controlled-control'
      )
    ).toHaveLength(1);
  });

  it('cancels a pending placement on Escape', () => {
    const { container, onCircuitChange } = setup(withX);

    arm(container, 'CNOT');
    tapWire(container, 0, COLUMN_CENTER[0]);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(container.querySelector('.circuit-editor__controlled--pending')).toBeNull();
    expect(isArmed(container, 'CNOT')).toBe(false);
    expect(hintText(container)).toBeNull();
    expect(onCircuitChange).not.toHaveBeenCalled();
  });

  it('cancels a pending placement when another tile is armed', () => {
    const { container, onCircuitChange } = setup(withX);

    arm(container, 'CNOT');
    tapWire(container, 0, COLUMN_CENTER[0]);
    arm(container, 'CZ');

    expect(container.querySelector('.circuit-editor__controlled--pending')).toBeNull();
    expect(hintText(container)).toBe('Tap a wire to place CZ');
    expect(onCircuitChange).not.toHaveBeenCalled();
  });

  it('collects two controls and a target for CCX', () => {
    const { container, onCircuitChange } = setup({ qubits: 3, gates: [] });

    arm(container, 'CCX');
    tapWire(container, 0, COLUMN_CENTER[0]);
    expect(hintText(container)).toBe('Tap the second control wire');

    tapWire(container, 1, COLUMN_CENTER[0]);
    expect(hintText(container)).toBe('Tap the target wire');
    expect(
      container.querySelectorAll(
        '.circuit-editor__controlled--pending .circuit-editor__controlled-control'
      )
    ).toHaveLength(2);
    expect(onCircuitChange).not.toHaveBeenCalled();

    // Re-tapping an already used wire stays a no-op.
    tapWire(container, 0, COLUMN_CENTER[0]);
    expect(onCircuitChange).not.toHaveBeenCalled();

    tapWire(container, 2, COLUMN_CENTER[0]);

    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'CCX', position: 0, control: 0, control2: 1, target: 2 },
    ]);
    expect(isArmed(container, 'CCX')).toBe(false);
  });
});

describe('tap-to-place: interaction with gate selection', () => {
  const withH: Circuit = {
    qubits: 2,
    gates: [{ id: 'h0', type: 'H', qubit: 0, position: 0 }],
  };

  it('selects a placed gate (showing its toolbar) when nothing is armed', () => {
    const { container } = setup(withH);

    fireEvent.click(container.querySelector('.circuit-editor__gate')!);

    expect(container.querySelector('.circuit-editor__toolbar')).toBeInTheDocument();
    expect(container.querySelector('[title="Delete"]')).toBeInTheDocument();
  });

  it('places instead of selecting when a gate is armed', () => {
    const { container, onCircuitChange } = setup(withH);

    arm(container, 'X');
    fireEvent.click(container.querySelector('.circuit-editor__gate')!, {
      clientX: COLUMN_CENTER[0],
      clientY: QUBIT_HEIGHT / 2,
    });

    expect(container.querySelector('.circuit-editor__toolbar')).toBeNull();
    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'X', position: 0, qubit: 0 },
      { type: 'H', position: 1, qubit: 0 },
    ]);
  });
});

describe('drag-and-drop placement still works', () => {
  /**
   * happy-dom builds drop events as a plain `Event`, which drops the MouseEvent
   * init — so `clientX` is pinned on afterwards, otherwise every drop would
   * snap to column 0 regardless of where it happened.
   */
  function dropGate(zone: Element, gateType: GateType, clientX: number) {
    const event = createEvent.drop(zone, {
      dataTransfer: {
        getData: (key: string) => (key === 'gateType' ? gateType : ''),
        types: ['gateType', `application/x-gate-${gateType.toLowerCase()}`],
      },
    });
    Object.defineProperty(event, 'clientX', { value: clientX });
    fireEvent(zone, event);
  }

  it('drops a single-qubit gate at the snapped column', () => {
    const { container, onCircuitChange } = setup({
      qubits: 2,
      gates: [{ id: 'h0', type: 'H', qubit: 1, position: 0 }],
    });

    const zone = container.querySelectorAll('.circuit-editor__drop-zone-continuous')[1];
    dropGate(zone, 'X', COLUMN_CENTER[1]);

    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'H', position: 0, qubit: 1 },
      { type: 'X', position: 1, qubit: 1 },
    ]);
  });

  it('drops a controlled gate spanning downwards from the drop lane', () => {
    const { container, onCircuitChange } = setup({ qubits: 3, gates: [] });

    const zone = container.querySelectorAll('.circuit-editor__drop-zone-continuous')[0];
    dropGate(zone, 'CNOT', COLUMN_CENTER[0]);

    expect(summarize(placedGates(onCircuitChange))).toEqual([
      { type: 'CNOT', position: 0, control: 0, target: 1 },
    ]);
  });
});
