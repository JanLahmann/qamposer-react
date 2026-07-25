import { describe, it, expect } from 'vitest';
import {
  circuitToQasm,
  qasmToCircuit,
  compactGates,
  createDefaultCircuit,
  validateQasm,
} from '../utils/openqasm';
import type { Circuit, Gate, GateType } from '../types';

// ============================================================================
// circuitToQasm
// ============================================================================

describe('circuitToQasm', () => {
  it('converts an empty circuit', () => {
    const circuit: Circuit = { qubits: 2, gates: [] };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('OPENQASM 2.0;');
    expect(qasm).toContain('qreg q[2];');
    expect(qasm).toContain('creg c[2];');
  });

  it('converts single-qubit gates', () => {
    const circuit: Circuit = {
      qubits: 2,
      gates: [
        { id: '1', type: 'H', qubit: 0, position: 0 },
        { id: '2', type: 'X', qubit: 1, position: 1 },
      ],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('h q[0];');
    expect(qasm).toContain('x q[1];');
  });

  it('converts S and T phase gates', () => {
    const circuit: Circuit = {
      qubits: 1,
      gates: [
        { id: '1', type: 'S', qubit: 0, position: 0 },
        { id: '2', type: 'T', qubit: 0, position: 1 },
      ],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('s q[0];');
    expect(qasm).toContain('t q[0];');
  });

  it('converts CNOT gate', () => {
    const circuit: Circuit = {
      qubits: 2,
      gates: [{ id: '1', type: 'CNOT', control: 0, target: 1, position: 0 }],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('cx q[0], q[1];');
  });

  it('converts rotation gates with pi fractions', () => {
    const circuit: Circuit = {
      qubits: 1,
      gates: [
        { id: '1', type: 'RX', qubit: 0, parameter: Math.PI / 2, position: 0 },
        { id: '2', type: 'RY', qubit: 0, parameter: Math.PI, position: 1 },
        { id: '3', type: 'RZ', qubit: 0, parameter: Math.PI / 4, position: 2 },
      ],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('rx(pi/2) q[0];');
    expect(qasm).toContain('ry(pi) q[0];');
    expect(qasm).toContain('rz(pi/4) q[0];');
  });

  it('converts rotation gates with arbitrary values', () => {
    const circuit: Circuit = {
      qubits: 1,
      gates: [{ id: '1', type: 'RX', qubit: 0, parameter: 1.23, position: 0 }],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('rx(1.23) q[0];');
  });

  it('sorts gates by position', () => {
    const circuit: Circuit = {
      qubits: 2,
      gates: [
        { id: '2', type: 'X', qubit: 0, position: 1 },
        { id: '1', type: 'H', qubit: 0, position: 0 },
      ],
    };
    const qasm = circuitToQasm(circuit);
    const hIndex = qasm.indexOf('h q[0];');
    const xIndex = qasm.indexOf('x q[0];');

    expect(hIndex).toBeLessThan(xIndex);
  });
});

// ============================================================================
// qasmToCircuit
// ============================================================================

describe('qasmToCircuit', () => {
  it('parses a basic circuit', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

h q[0];
cx q[0], q[1];
`;
    const result = qasmToCircuit(qasm);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.circuit).toBeDefined();
    expect(result.circuit!.qubits).toBe(2);
    expect(result.circuit!.gates).toHaveLength(2);
    expect(result.circuit!.gates[0].type).toBe('H');
    expect(result.circuit!.gates[1].type).toBe('CNOT');
  });

  it('parses rotation gates with pi expressions', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];

rx(pi/2) q[0];
ry(pi) q[0];
rz(-pi/4) q[0];
`;
    const result = qasmToCircuit(qasm);

    expect(result.success).toBe(true);
    expect(result.circuit!.gates).toHaveLength(3);
    expect(result.circuit!.gates[0].type).toBe('RX');
    expect(result.circuit!.gates[0].parameter).toBeCloseTo(Math.PI / 2);
    expect(result.circuit!.gates[1].parameter).toBeCloseTo(Math.PI);
    expect(result.circuit!.gates[2].parameter).toBeCloseTo(-Math.PI / 4);
  });

  it('parses S and T phase gates', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];

s q[0];
t q[0];
`;
    const result = qasmToCircuit(qasm);

    expect(result.success).toBe(true);
    expect(result.circuit!.gates).toHaveLength(2);
    expect(result.circuit!.gates[0].type).toBe('S');
    expect(result.circuit!.gates[1].type).toBe('T');
  });

  it('reports error for missing semicolons', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

h q[0]
`;
    const result = qasmToCircuit(qasm);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('semicolon');
  });

  it('reports error for out-of-range qubit indices', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

h q[5];
`;
    const result = qasmToCircuit(qasm);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('exceeds');
  });

  it('reports error for unknown instructions', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

foo q[0];
`;
    const result = qasmToCircuit(qasm);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Unknown instruction');
  });

  it('skips comments and blank lines', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

// This is a comment
h q[0];

x q[1];
`;
    const result = qasmToCircuit(qasm);

    expect(result.success).toBe(true);
    expect(result.circuit!.gates).toHaveLength(2);
  });

  it('defaults to 2 qubits when no qreg found', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";

h q[0];
`;
    const result = qasmToCircuit(qasm);

    expect(result.circuit!.qubits).toBe(2);
  });
});

// ============================================================================
// Roundtrip: circuitToQasm -> qasmToCircuit
// ============================================================================

describe('roundtrip conversion', () => {
  it('preserves circuit through qasm roundtrip', () => {
    const original: Circuit = {
      qubits: 3,
      gates: [
        { id: '1', type: 'H', qubit: 0, position: 0 },
        { id: '2', type: 'CNOT', control: 0, target: 1, position: 1 },
        { id: '3', type: 'RZ', qubit: 2, parameter: Math.PI / 2, position: 1 },
        { id: '4', type: 'X', qubit: 2, position: 2 },
      ],
    };

    const qasm = circuitToQasm(original);
    const result = qasmToCircuit(qasm);

    expect(result.success).toBe(true);
    expect(result.circuit!.qubits).toBe(original.qubits);
    expect(result.circuit!.gates).toHaveLength(original.gates.length);

    // Verify gate types are preserved
    const originalTypes = original.gates.map((g) => g.type).sort();
    const parsedTypes = result.circuit!.gates.map((g) => g.type).sort();
    expect(parsedTypes).toEqual(originalTypes);
  });
});

// ============================================================================
// Controlled gates: CY, CZ, CH, CS, CT, CCX
// ============================================================================

describe('controlled gates', () => {
  const controlled = (type: GateType, control: number, target: number): Gate => ({
    id: '1',
    type,
    control,
    target,
    position: 0,
  });

  const withHeader = (...instructions: string[]) =>
    ['OPENQASM 2.0;', 'include "qelib1.inc";', '', 'qreg q[3];', 'creg c[3];', '', ...instructions]
      .join('\n')
      .concat('\n');

  it('emits the qelib1 names for CY, CZ, CH and CCX', () => {
    const circuit: Circuit = {
      qubits: 3,
      gates: [
        { id: '1', type: 'CY', control: 0, target: 1, position: 0 },
        { id: '2', type: 'CZ', control: 0, target: 1, position: 1 },
        { id: '3', type: 'CH', control: 0, target: 1, position: 2 },
        { id: '4', type: 'CCX', control: 0, control2: 1, target: 2, position: 3 },
      ],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('cy q[0], q[1];');
    expect(qasm).toContain('cz q[0], q[1];');
    expect(qasm).toContain('ch q[0], q[1];');
    expect(qasm).toContain('ccx q[0], q[1], q[2];');
  });

  it('emits CS and CT as cu1 phase gates', () => {
    const circuit: Circuit = {
      qubits: 2,
      gates: [controlled('CS', 0, 1), { ...controlled('CT', 0, 1), id: '2', position: 1 }],
    };
    const qasm = circuitToQasm(circuit);

    expect(qasm).toContain('cu1(pi/2) q[0], q[1];');
    expect(qasm).toContain('cu1(pi/4) q[0], q[1];');
  });

  it('matches the golden ch and ccx fixtures byte for byte', () => {
    expect(circuitToQasm({ qubits: 5, gates: [controlled('CH', 0, 1)] })).toBe(
      `OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

ch q[0], q[1];
`
    );
    expect(
      circuitToQasm({
        qubits: 5,
        gates: [{ id: '1', type: 'CCX', control: 0, control2: 1, target: 2, position: 0 }],
      })
    ).toBe(
      `OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

ccx q[0], q[1], q[2];
`
    );
  });

  it('parses cy, cz and ch back into control/target', () => {
    const result = qasmToCircuit(withHeader('cy q[0], q[1];', 'cz q[1], q[2];', 'ch q[2], q[0];'));

    expect(result.success).toBe(true);
    expect(result.circuit!.gates.map((g) => g.type)).toEqual(['CY', 'CZ', 'CH']);
    expect(result.circuit!.gates[0]).toMatchObject({ control: 0, target: 1 });
    expect(result.circuit!.gates[1]).toMatchObject({ control: 1, target: 2 });
    expect(result.circuit!.gates[2]).toMatchObject({ control: 2, target: 0 });
  });

  it('parses ccx into control, control2 and target', () => {
    const result = qasmToCircuit(withHeader('ccx q[0], q[1], q[2];'));

    expect(result.success).toBe(true);
    expect(result.circuit!.gates).toHaveLength(1);
    expect(result.circuit!.gates[0]).toMatchObject({
      type: 'CCX',
      control: 0,
      control2: 1,
      target: 2,
    });
  });

  it('parses cu1(pi/2) as CS and cu1(pi/4) as CT', () => {
    const result = qasmToCircuit(withHeader('cu1(pi/2) q[0], q[1];', 'cu1(pi/4) q[0], q[1];'));

    expect(result.success).toBe(true);
    expect(result.circuit!.gates.map((g) => g.type)).toEqual(['CS', 'CT']);
  });

  it('rejects a cu1 angle that is neither pi/2 nor pi/4', () => {
    const result = qasmToCircuit(withHeader('cu1(pi/3) q[0], q[1];'));

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('unsupported cu1 angle');
  });

  it('rejects controlled gates acting twice on the same qubit', () => {
    for (const instruction of ['cz q[1], q[1];', 'ccx q[0], q[1], q[1];']) {
      const result = qasmToCircuit(withHeader(instruction));
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/requires distinct qubits/);
    }
  });

  it('rejects controlled gates outside the register', () => {
    const result = qasmToCircuit(withHeader('ccx q[0], q[1], q[7];'));

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('exceeds defined qubits');
  });

  it('round-trips every controlled gate', () => {
    const original: Circuit = {
      qubits: 3,
      gates: [
        { id: '1', type: 'CNOT', control: 0, target: 1, position: 0 },
        { id: '2', type: 'CY', control: 0, target: 1, position: 1 },
        { id: '3', type: 'CZ', control: 0, target: 1, position: 2 },
        { id: '4', type: 'CH', control: 0, target: 1, position: 3 },
        { id: '5', type: 'CS', control: 0, target: 1, position: 4 },
        { id: '6', type: 'CT', control: 0, target: 1, position: 5 },
        { id: '7', type: 'CCX', control: 0, control2: 1, target: 2, position: 6 },
      ],
    };

    const result = qasmToCircuit(circuitToQasm(original));

    expect(result.success).toBe(true);
    expect(result.circuit!.gates.map((g) => g.type)).toEqual(original.gates.map((g) => g.type));
    result.circuit!.gates.forEach((gate, index) => {
      expect(gate.control).toBe(original.gates[index].control);
      expect(gate.control2).toBe(original.gates[index].control2);
      expect(gate.target).toBe(original.gates[index].target);
      expect(gate.qubit).toBeUndefined();
    });
  });
});

// ============================================================================
// compactGates
// ============================================================================

describe('compactGates', () => {
  it('compacts gates to left-align', () => {
    const gates: Gate[] = [
      { id: '1', type: 'H', qubit: 0, position: 3 },
      { id: '2', type: 'X', qubit: 1, position: 5 },
    ];
    const compacted = compactGates(gates);

    // Gates on different qubits can occupy position 0
    expect(compacted[0].position).toBe(0);
    expect(compacted[1].position).toBe(0);
  });

  it('respects gate ordering on the same qubit', () => {
    const gates: Gate[] = [
      { id: '1', type: 'H', qubit: 0, position: 0 },
      { id: '2', type: 'X', qubit: 0, position: 2 },
    ];
    const compacted = compactGates(gates);

    expect(compacted[0].position).toBe(0);
    expect(compacted[1].position).toBe(1);
  });

  it('handles CNOT spanning multiple qubits', () => {
    const gates: Gate[] = [
      { id: '1', type: 'CNOT', control: 0, target: 2, position: 0 },
      { id: '2', type: 'H', qubit: 1, position: 1 },
    ];
    const compacted = compactGates(gates);

    // CNOT spans q0-q2, so H on q1 must come after
    expect(compacted[0].position).toBe(0); // CNOT
    expect(compacted[1].position).toBe(1); // H
  });
});

// ============================================================================
// createDefaultCircuit
// ============================================================================

describe('createDefaultCircuit', () => {
  it('creates a circuit with default 2 qubits', () => {
    const circuit = createDefaultCircuit();
    expect(circuit.qubits).toBe(2);
    expect(circuit.gates).toEqual([]);
  });

  it('clamps to minimum of 2 qubits', () => {
    const circuit = createDefaultCircuit(0);
    expect(circuit.qubits).toBe(2);
  });

  it('clamps to maximum of 5 qubits', () => {
    const circuit = createDefaultCircuit(10);
    expect(circuit.qubits).toBe(5);
  });
});

// ============================================================================
// validateQasm
// ============================================================================

describe('validateQasm', () => {
  it('returns empty array for valid QASM', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

h q[0];
`;
    expect(validateQasm(qasm)).toEqual([]);
  });

  it('returns errors for invalid QASM', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

h q[0]
`;
    const errors = validateQasm(qasm);
    expect(errors.length).toBeGreaterThan(0);
  });
});
