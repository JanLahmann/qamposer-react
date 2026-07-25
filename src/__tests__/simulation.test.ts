import { describe, it, expect } from 'vitest';
import {
  simulateStatevector,
  probabilities,
  sampleCounts,
  computeQspherePoints,
  DEFAULT_ROTATION_ANGLE,
} from '../simulation';
import type { SimulationGate, StateVector } from '../simulation';
import type { QSpherePoint } from '../types';
import parityFixture from './fixtures/qsphere-parity.json';

const SQRT1_2 = Math.SQRT1_2;

function bell(): SimulationGate[] {
  return [
    { type: 'H', qubit: 0, position: 0 },
    { type: 'CNOT', control: 0, target: 1, position: 1 },
  ];
}

describe('simulateStatevector', () => {
  it('produces the Bell state', () => {
    const state = simulateStatevector(2, bell());
    expect(state.re[0]).toBeCloseTo(SQRT1_2, 12);
    expect(state.re[3]).toBeCloseTo(SQRT1_2, 12);
    expect(state.re[1]).toBeCloseTo(0, 12);
    expect(state.re[2]).toBeCloseTo(0, 12);
    expect(Array.from(state.im).every((v) => Math.abs(v) < 1e-12)).toBe(true);
  });

  it('produces the GHZ state on 3 qubits', () => {
    const state = simulateStatevector(3, [
      { type: 'H', qubit: 0, position: 0 },
      { type: 'CNOT', control: 0, target: 1, position: 1 },
      { type: 'CNOT', control: 0, target: 2, position: 2 },
    ]);
    const probs = probabilities(state);
    expect(probs[0]).toBeCloseTo(0.5, 12);
    expect(probs[7]).toBeCloseTo(0.5, 12);
    for (let i = 1; i < 7; i++) {
      expect(probs[i]).toBeCloseTo(0, 12);
    }
  });

  it('returns |0...0> for an empty circuit', () => {
    const state = simulateStatevector(3, []);
    expect(state.re[0]).toBe(1);
    expect(
      probabilities(state)
        .slice(1)
        .every((p) => p === 0)
    ).toBe(true);
  });

  it('applies gates in position order', () => {
    // X at position 0 then CNOT at position 1, provided out of order
    const state = simulateStatevector(2, [
      { type: 'CNOT', control: 0, target: 1, position: 1 },
      { type: 'X', qubit: 0, position: 0 },
    ]);
    // |00> -> X q0 -> |01> -> CNOT -> |11> (index 3)
    expect(probabilities(state)[3]).toBeCloseTo(1, 12);
  });

  it('defaults missing rotation parameter to the backend literal, not 0', () => {
    const state = simulateStatevector(1, [{ type: 'RX', qubit: 0, position: 0 }]);
    const expected = Math.sin(DEFAULT_ROTATION_ANGLE / 2) ** 2;
    expect(probabilities(state)[1]).toBeCloseTo(expected, 12);
    expect(expected).toBeGreaterThan(0.1); // sanity: clearly not the 0 default
    expect(DEFAULT_ROTATION_ANGLE).not.toBe(Math.PI / 4);
  });

  it('applies the S gate as diag(1, i)', () => {
    // X then S: |0> -> |1> -> i|1>
    const state = simulateStatevector(1, [
      { type: 'X', qubit: 0, position: 0 },
      { type: 'S', qubit: 0, position: 1 },
    ]);
    expect(state.re[1]).toBeCloseTo(0, 12);
    expect(state.im[1]).toBeCloseTo(1, 12);
    expect(probabilities(state)[1]).toBeCloseTo(1, 12);
  });

  it('applies the T gate as diag(1, e^{i*pi/4})', () => {
    // X then T: |0> -> |1> -> e^{i*pi/4}|1>
    const state = simulateStatevector(1, [
      { type: 'X', qubit: 0, position: 0 },
      { type: 'T', qubit: 0, position: 1 },
    ]);
    expect(state.re[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(state.im[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(probabilities(state)[1]).toBeCloseTo(1, 12);
  });

  it('composes T twice into S (both diag(1, i) on |1>)', () => {
    // X then T then T: |0> -> |1> -> e^{i*pi/2}|1> = i|1>
    const state = simulateStatevector(1, [
      { type: 'X', qubit: 0, position: 0 },
      { type: 'T', qubit: 0, position: 1 },
      { type: 'T', qubit: 0, position: 2 },
    ]);
    expect(state.re[1]).toBeCloseTo(0, 12);
    expect(state.im[1]).toBeCloseTo(1, 12);
  });

  it('rejects single-qubit gates without a qubit index', () => {
    expect(() => simulateStatevector(1, [{ type: 'H', position: 0 }])).toThrow(
      'requires a qubit index'
    );
  });

  it('rejects CNOT with identical control and target', () => {
    expect(() =>
      simulateStatevector(2, [{ type: 'CNOT', control: 1, target: 1, position: 0 }])
    ).toThrow('distinct control and target');
  });

  it('rejects out-of-range qubit indices', () => {
    expect(() => simulateStatevector(2, [{ type: 'X', qubit: 2, position: 0 }])).toThrow(
      'out of range'
    );
    expect(() =>
      simulateStatevector(2, [{ type: 'CNOT', control: 0, target: 2, position: 0 }])
    ).toThrow('out of range');
  });
});

// Basis index i has qubit q set when (i >> q) & 1. With control q0 and target
// q1: |00> -> 0, control-only -> 1, target-only -> 2, both -> 3.
describe('controlled gates', () => {
  const both = (type: SimulationGate['type']): SimulationGate[] => [
    { type: 'X', qubit: 0, position: 0 },
    { type: 'X', qubit: 1, position: 1 },
    { type, control: 0, target: 1, position: 2 },
  ];

  it('CH on an |+> control produces (|00> + (|10> + |11>)/sqrt2)/sqrt2', () => {
    const state = simulateStatevector(2, [
      { type: 'H', qubit: 0, position: 0 },
      { type: 'CH', control: 0, target: 1, position: 1 },
    ]);
    expect(state.re[0]).toBeCloseTo(SQRT1_2, 12);
    expect(state.re[1]).toBeCloseTo(0.5, 12);
    expect(state.re[3]).toBeCloseTo(0.5, 12);
    expect(state.re[2]).toBeCloseTo(0, 12);
  });

  it('CZ flips the sign of |11> only', () => {
    const state = simulateStatevector(2, both('CZ'));
    expect(state.re[3]).toBeCloseTo(-1, 12);
    expect(state.im[3]).toBeCloseTo(0, 12);
  });

  it('CY maps |11> to -i|10> (Y|1> = -i|0>)', () => {
    const state = simulateStatevector(2, both('CY'));
    expect(state.re[1]).toBeCloseTo(0, 12);
    expect(state.im[1]).toBeCloseTo(-1, 12);
  });

  it('CS applies the phase i to |11> (controlled-phase, not controlled-RZ)', () => {
    const state = simulateStatevector(2, both('CS'));
    expect(state.re[3]).toBeCloseTo(0, 12);
    expect(state.im[3]).toBeCloseTo(1, 12);
  });

  it('CT applies the phase e^{i*pi/4} to |11>', () => {
    const state = simulateStatevector(2, both('CT'));
    expect(state.re[3]).toBeCloseTo(SQRT1_2, 12);
    expect(state.im[3]).toBeCloseTo(SQRT1_2, 12);
  });

  it('CS is a no-op when the control or the target is |0>', () => {
    const controlZero = simulateStatevector(2, [
      { type: 'X', qubit: 1, position: 0 },
      { type: 'CS', control: 0, target: 1, position: 1 },
    ]);
    expect(controlZero.re[2]).toBeCloseTo(1, 12);

    const targetZero = simulateStatevector(2, [
      { type: 'X', qubit: 0, position: 0 },
      { type: 'CS', control: 0, target: 1, position: 1 },
    ]);
    expect(targetZero.re[1]).toBeCloseTo(1, 12);
  });

  it('CCX flips the target only when both controls are |1>', () => {
    const ccx: SimulationGate = { type: 'CCX', control: 0, control2: 1, target: 2, position: 3 };
    const probTargetOne = (gates: SimulationGate[]) => {
      const probs = probabilities(simulateStatevector(3, gates));
      let p = 0;
      for (let i = 0; i < probs.length; i++) {
        if (i & 0b100) p += probs[i];
      }
      return p;
    };

    // |110> (q0 = q1 = 1) -> |111>
    expect(
      probTargetOne([
        { type: 'X', qubit: 0, position: 0 },
        { type: 'X', qubit: 1, position: 1 },
        ccx,
      ])
    ).toBeCloseTo(1, 10);
    // only one control set, or none -> target unchanged
    expect(probTargetOne([{ type: 'X', qubit: 0, position: 0 }, ccx])).toBeCloseTo(0, 10);
    expect(probTargetOne([{ type: 'X', qubit: 1, position: 0 }, ccx])).toBeCloseTo(0, 10);
    expect(probTargetOne([ccx])).toBeCloseTo(0, 10);
  });

  it('CCX on a superposition of controls flips only the |11> branch', () => {
    const state = simulateStatevector(3, [
      { type: 'H', qubit: 0, position: 0 },
      { type: 'H', qubit: 1, position: 1 },
      { type: 'CCX', control: 0, control2: 1, target: 2, position: 2 },
    ]);
    // controls |11> -> target flipped: index 0b111 = 7
    expect(state.re[7]).toBeCloseTo(0.5, 12);
    // the other three control branches keep the target at |0>
    expect(state.re[0]).toBeCloseTo(0.5, 12);
    expect(state.re[1]).toBeCloseTo(0.5, 12);
    expect(state.re[2]).toBeCloseTo(0.5, 12);
  });

  it('CNOT and a generic controlled-X agree on the Bell state', () => {
    const viaCnot = simulateStatevector(2, bell());
    const viaCcxLike = simulateStatevector(2, [
      { type: 'H', qubit: 0, position: 0 },
      { type: 'CZ', control: 0, target: 1, position: 1 },
    ]);
    // CZ leaves the magnitudes of H|0>|0> untouched (only phases)
    expect(probabilities(viaCnot)[3]).toBeCloseTo(0.5, 12);
    expect(probabilities(viaCcxLike)[1]).toBeCloseTo(0.5, 12);
  });

  it('rejects controlled gates with missing or colliding qubits', () => {
    expect(() => simulateStatevector(2, [{ type: 'CZ', control: 0, position: 0 }])).toThrow(
      'CZ gate requires control and target qubits'
    );
    expect(() =>
      simulateStatevector(3, [{ type: 'CCX', control: 0, target: 2, position: 0 }])
    ).toThrow('CCX gate requires control, control2 and target qubits');
    expect(() =>
      simulateStatevector(2, [{ type: 'CH', control: 1, target: 1, position: 0 }])
    ).toThrow('distinct control and target');
    expect(() =>
      simulateStatevector(3, [{ type: 'CCX', control: 0, control2: 1, target: 1, position: 0 }])
    ).toThrow('distinct control and target');
    expect(() =>
      simulateStatevector(3, [{ type: 'CCX', control: 0, control2: 1, target: 3, position: 0 }])
    ).toThrow('out of range');
  });
});

describe('sampleCounts', () => {
  it('uses Qiskit little-endian bitstring keys (qubit 0 rightmost)', () => {
    const state = simulateStatevector(2, [{ type: 'X', qubit: 0, position: 0 }]);
    const counts = sampleCounts(probabilities(state), 2, 100, 1);
    expect(counts).toEqual({ '01': 100 });
  });

  it('samples only non-zero-probability states and preserves shot total', () => {
    const counts = sampleCounts(probabilities(simulateStatevector(2, bell())), 2, 1024, 7);
    expect(Object.keys(counts).sort()).toEqual(['00', '11']);
    expect(counts['00'] + counts['11']).toBe(1024);
  });

  it('is deterministic for the same seed and varies across seeds', () => {
    const probs = probabilities(simulateStatevector(2, bell()));
    const a = sampleCounts(probs, 2, 1024, 42);
    const b = sampleCounts(probs, 2, 1024, 42);
    const c = sampleCounts(probs, 2, 1024, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('computeQspherePoints', () => {
  it('places the weight-1 ring of 2 qubits with the official mirror rule', () => {
    const state: StateVector = {
      re: new Float64Array([0, SQRT1_2, SQRT1_2, 0]),
      im: new Float64Array(4),
    };
    const points = computeQspherePoints(state, 2);
    expect(points.map((p) => p.state)).toEqual(['01', '10']);
    const [p01, p10] = points;
    expect(p01.x).toBeCloseTo(-1, 9);
    expect(p01.y).toBeCloseTo(0, 9);
    expect(p01.z).toBeCloseTo(0, 9);
    expect(p10.x).toBeCloseTo(1, 9);
    expect(p10.y).toBeCloseTo(0, 9);
    expect(p10.z).toBeCloseTo(0, 9);
  });

  it('uses z linear in Hamming weight (official), not linear theta', () => {
    // n=3 weight-1 ring must sit at z = 1/3, not cos(pi/3) = 0.5
    const re = new Float64Array(8);
    re[1] = re[2] = re[4] = Math.sqrt(1 / 3);
    const points = computeQspherePoints({ re, im: new Float64Array(8) }, 3);
    for (const p of points) {
      expect(p.z).toBeCloseTo(1 / 3, 9);
    }
  });

  it('removes the global phase before computing point phases', () => {
    // e^{i*pi/6}|1>: dominant amplitude's phase is normalized away
    const angle = Math.PI / 6;
    const state: StateVector = {
      re: new Float64Array([0, Math.cos(angle)]),
      im: new Float64Array([0, Math.sin(angle)]),
    };
    const [point] = computeQspherePoints(state, 1);
    expect(point.state).toBe('1');
    expect(point.phase).toBeCloseTo(0, 9);
    expect(point.z).toBeCloseTo(-1, 9);
  });

  it('omits points below the 1e-12 probability threshold', () => {
    const points = computeQspherePoints(simulateStatevector(2, bell()), 2);
    expect(points.map((p) => p.state)).toEqual(['00', '11']);
  });
});

interface ParityCase {
  description: string;
  qubits: number;
  gates: SimulationGate[];
  expected_qsphere: QSpherePoint[];
}

describe('q-sphere parity with official Qiskit plot_state_qsphere', () => {
  // The fixture holds parity cases plus a string `_comment` key
  const cases = Object.entries(
    parityFixture as unknown as Record<string, ParityCase | string>
  ).filter((entry): entry is [string, ParityCase] => typeof entry[1] !== 'string');

  it.each(cases)('%s matches the official layout', (_name, testCase) => {
    const state = simulateStatevector(testCase.qubits, testCase.gates);
    const points = computeQspherePoints(state, testCase.qubits);
    expect(points).toHaveLength(testCase.expected_qsphere.length);
    points.forEach((point, i) => {
      const expected = testCase.expected_qsphere[i];
      expect(point.state).toBe(expected.state);
      expect(point.x).toBeCloseTo(expected.x, 9);
      expect(point.y).toBeCloseTo(expected.y, 9);
      expect(point.z).toBeCloseTo(expected.z, 9);
      expect(point.probability).toBeCloseTo(expected.probability, 9);
      expect(point.phase).toBeCloseTo(expected.phase, 9);
    });
  });
});
