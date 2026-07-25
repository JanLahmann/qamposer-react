import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QamposerMicro } from '../presets/QamposerMicro';
import { noopAdapter } from '../adapters/noop';
import type { Circuit, GateType } from '../types';

// 3 qubits so that no controlled gate (CCX needs 3) renders as disabled.
const circuit: Circuit = { qubits: 3, gates: [] };

/**
 * Single-qubit palette tiles carry their label as text; controlled tiles are
 * SVG icons, identified here by the tooltip (the gate description).
 */
const CONTROLLED_TITLES: Partial<Record<GateType, string>> = {
  CNOT: 'Controlled-NOT',
  CY: 'Controlled-Y',
  CZ: 'Controlled-Z',
  CH: 'Controlled-H',
  CS: 'Controlled-S',
  CT: 'Controlled-T',
  CCX: 'Toffoli (CCX)',
};

const ALL_GATE_TYPES: GateType[] = [
  'H',
  'X',
  'Y',
  'Z',
  'S',
  'T',
  'RX',
  'RY',
  'RZ',
  'CNOT',
  'CY',
  'CZ',
  'CH',
  'CS',
  'CT',
  'CCX',
];

/** Expand both palette sections (Multi-Qubit is collapsed by default). */
function expandSections(container: HTMLElement) {
  container.querySelectorAll('.operations__section-header').forEach((header) => {
    const expanded = header.parentElement?.querySelector('.operations__grid');
    if (!expanded) fireEvent.click(header);
  });
}

/** Gate types currently visible in the palette, in render order. */
function visibleGateTypes(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.operations__gate')).map((tile) => {
    const label = tile.querySelector('.operations__gate-label')?.textContent;
    if (label) return label;
    const title = tile.getAttribute('title');
    const match = Object.entries(CONTROLLED_TITLES).find(([, desc]) => desc === title);
    return match ? match[0] : `?(${title})`;
  });
}

function sectionTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.operations__section-header')).map(
    (header) => header.textContent ?? ''
  );
}

describe('Operations gateTypes filter', () => {
  it('renders the full palette when gateTypes is undefined', () => {
    const { container } = render(<QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} />);
    expandSections(container);

    expect(visibleGateTypes(container)).toEqual(ALL_GATE_TYPES);
    expect(sectionTitles(container)).toHaveLength(2);
  });

  it('renders exactly the listed gates, in library order', () => {
    const { container } = render(
      <QamposerMicro
        adapter={noopAdapter}
        defaultCircuit={circuit}
        // deliberately out of library order — GATE_DEFINITIONS order must win
        gateTypes={['CNOT', 'X', 'H']}
      />
    );
    expandSections(container);

    expect(visibleGateTypes(container)).toEqual(['H', 'X', 'CNOT']);
  });

  it('keeps rotation gates in the single-qubit section', () => {
    const { container } = render(
      <QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} gateTypes={['H', 'RZ']} />
    );
    expandSections(container);

    expect(visibleGateTypes(container)).toEqual(['H', 'RZ']);
    expect(sectionTitles(container)).toEqual(['Single-Qubit Gates']);
  });

  it('hides the multi-qubit section when no multi-qubit gate is listed', () => {
    const { container } = render(
      <QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} gateTypes={['H', 'X']} />
    );
    expandSections(container);

    expect(sectionTitles(container)).toEqual(['Single-Qubit Gates']);
    expect(visibleGateTypes(container)).toEqual(['H', 'X']);
  });

  it('hides the single-qubit section when only multi-qubit gates are listed', () => {
    const { container } = render(
      <QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} gateTypes={['CNOT', 'CCX']} />
    );
    expandSections(container);

    expect(sectionTitles(container)).toEqual(['Multi-Qubit Gates']);
    expect(visibleGateTypes(container)).toEqual(['CNOT', 'CCX']);
  });

  it('hides both sections for an empty gateTypes array', () => {
    const { container } = render(
      <QamposerMicro adapter={noopAdapter} defaultCircuit={circuit} gateTypes={[]} />
    );

    expect(container.querySelector('.operations')).toBeInTheDocument();
    expect(sectionTitles(container)).toEqual([]);
    expect(visibleGateTypes(container)).toEqual([]);
  });

  it('ignores unknown gate types at runtime', () => {
    const { container } = render(
      <QamposerMicro
        adapter={noopAdapter}
        defaultCircuit={circuit}
        gateTypes={['H', 'NOPE' as GateType]}
      />
    );
    expandSections(container);

    expect(visibleGateTypes(container)).toEqual(['H']);
  });

  it('does not filter the gate editor shown while editing a placed gate', () => {
    const withGate: Circuit = {
      qubits: 3,
      gates: [{ id: 'rz', type: 'RZ', qubit: 0, position: 0, parameter: Math.PI }],
    };
    const { container } = render(
      <QamposerMicro adapter={noopAdapter} defaultCircuit={withGate} gateTypes={['H']} />
    );

    const placed = container.querySelector('.circuit-editor__gate');
    expect(placed).toBeInTheDocument();
    fireEvent.click(placed!); // select, revealing the gate toolbar

    const editButton = container.querySelector('[title="Edit operation"]');
    expect(editButton).toBeInTheDocument();
    fireEvent.click(editButton!);

    expect(container.querySelector('.operations--editor')).toBeInTheDocument();
    expect(container.querySelector('#theta-input')).toBeInTheDocument();
  });
});
