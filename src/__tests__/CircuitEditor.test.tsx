import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QamposerMicro } from '../presets/QamposerMicro';
import { noopAdapter } from '../adapters/noop';
import type { Circuit } from '../types';

const QUBIT_HEIGHT = 80;

describe('CircuitEditor controlled gates', () => {
  const circuit: Circuit = {
    qubits: 3,
    gates: [
      { id: 'ch', type: 'CH', control: 0, target: 1, position: 0 },
      { id: 'ccx', type: 'CCX', control: 0, control2: 1, target: 2, position: 1 },
    ],
  };

  it('renders one wrapper per controlled gate', () => {
    const { container } = render(<QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} />);

    expect(container.querySelectorAll('.circuit-editor__controlled')).toHaveLength(2);
    // one line per gate, spanning every lane it touches
    expect(container.querySelectorAll('.circuit-editor__controlled-line')).toHaveLength(2);
  });

  it('renders a dot per control qubit (1 for CH, 2 for CCX)', () => {
    const { container } = render(<QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} />);

    expect(container.querySelectorAll('.circuit-editor__controlled-control')).toHaveLength(3);
  });

  it('renders the boxed base letter for CH and the ⊕ target for CCX', () => {
    const { container } = render(<QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} />);

    const boxes = container.querySelectorAll('.circuit-editor__controlled-box');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveTextContent('H');

    expect(container.querySelectorAll('.circuit-editor__controlled-target')).toHaveLength(1);
  });

  it('positions the parts by absolute qubit row', () => {
    const { container } = render(<QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} />);

    const ccx = container.querySelectorAll('.circuit-editor__controlled')[1] as HTMLElement;
    // CCX spans q0..q2
    expect(ccx.style.top).toBe(`${QUBIT_HEIGHT / 2}px`);
    expect(ccx.style.height).toBe(`${2 * QUBIT_HEIGHT}px`);

    const controls = ccx.querySelectorAll<HTMLElement>('.circuit-editor__controlled-control');
    expect(Array.from(controls).map((dot) => dot.style.top)).toEqual(['0px', `${QUBIT_HEIGHT}px`]);

    const target = ccx.querySelector<HTMLElement>('.circuit-editor__controlled-target');
    expect(target?.style.top).toBe(`${2 * QUBIT_HEIGHT}px`);
  });
});
