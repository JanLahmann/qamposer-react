import { describe, it, expect } from 'vitest';
import {
  CONTROLLED_GATE_TYPES,
  controlsOf,
  getGateQubits,
  isControlledGate,
  isTwoQubitControlledGate,
} from './gates';
import type { Gate } from '../types';

/** Typed helper so object literals are checked against `Gate`, not the subset. */
const gate = (fields: Omit<Gate, 'id' | 'position'>): Gate => ({ id: '1', position: 0, ...fields });

describe('isControlledGate', () => {
  it('covers CNOT and the whole controlled family', () => {
    expect(CONTROLLED_GATE_TYPES).toEqual(['CNOT', 'CY', 'CZ', 'CH', 'CS', 'CT', 'CCX']);
    for (const type of CONTROLLED_GATE_TYPES) {
      expect(isControlledGate(type)).toBe(true);
    }
  });

  it('is false for single-qubit and rotation gates', () => {
    for (const type of ['H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ'] as const) {
      expect(isControlledGate(type)).toBe(false);
    }
  });

  it('excludes CCX from the two-qubit family', () => {
    expect(isTwoQubitControlledGate('CZ')).toBe(true);
    expect(isTwoQubitControlledGate('CCX')).toBe(false);
  });
});

describe('controlsOf', () => {
  it('returns one control for the two-qubit family', () => {
    expect(controlsOf(gate({ type: 'CZ', control: 2, target: 0 }))).toEqual([2]);
  });

  it('returns both controls for CCX', () => {
    expect(controlsOf(gate({ type: 'CCX', control: 1, control2: 3, target: 0 }))).toEqual([1, 3]);
  });

  it('returns nothing for non-controlled or malformed gates', () => {
    expect(controlsOf(gate({ type: 'H', qubit: 0 }))).toEqual([]);
    expect(controlsOf(gate({ type: 'CZ', target: 1 }))).toEqual([]);
    expect(controlsOf(gate({ type: 'CCX', control: 0, target: 2 }))).toEqual([]);
  });
});

describe('getGateQubits', () => {
  it('returns the single qubit of a one-qubit gate', () => {
    expect(getGateQubits(gate({ type: 'T', qubit: 3 }))).toEqual([3]);
    expect(getGateQubits(gate({ type: 'H' }))).toEqual([]);
  });

  it('spans every lane between control and target', () => {
    expect(getGateQubits(gate({ type: 'CH', control: 0, target: 3 }))).toEqual([0, 1, 2, 3]);
    // orientation does not matter — the span is inclusive min..max
    expect(getGateQubits(gate({ type: 'CH', control: 3, target: 0 }))).toEqual([0, 1, 2, 3]);
  });

  it('spans across both controls and the target for CCX', () => {
    expect(getGateQubits(gate({ type: 'CCX', control: 4, control2: 1, target: 2 }))).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
