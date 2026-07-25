/**
 * Shared helpers for controlled gates.
 *
 * A controlled gate is described by `control` (+ `control2` for CCX) and
 * `target` — `qubit` stays undefined. These helpers are the single source of
 * truth for "which qubits does this gate occupy", used by the QASM layer, the
 * circuit editor, the provider's conflict checks and the keyboard commands.
 */

import type { Gate, GateType } from '../types';

/** Every gate type drawn as control dot(s) + a vertical line + a target. */
export const CONTROLLED_GATE_TYPES: GateType[] = ['CNOT', 'CY', 'CZ', 'CH', 'CS', 'CT', 'CCX'];

/** Controlled gates with exactly one control qubit (everything but CCX). */
export const TWO_QUBIT_CONTROLLED_GATE_TYPES: GateType[] = CONTROLLED_GATE_TYPES.filter(
  (type) => type !== 'CCX'
);

/**
 * Base letter drawn inside the target box of a boxed controlled gate.
 * CNOT and CCX use the ⊕ target symbol instead and are absent here.
 */
export const CONTROLLED_TARGET_LABELS: Partial<Record<GateType, string>> = {
  CY: 'Y',
  CZ: 'Z',
  CH: 'H',
  CS: 'S',
  CT: 'T',
};

/**
 * The subset of `Gate` these helpers read. Accepting the structural subset lets
 * the simulator (which works on `Omit<Gate, 'id'>`) share the same code.
 */
export type GateQubitFields = Pick<Gate, 'type' | 'qubit' | 'control' | 'control2' | 'target'>;

/** True for CNOT, CY, CZ, CH, CS, CT and CCX. */
export function isControlledGate(type: GateType): boolean {
  return CONTROLLED_GATE_TYPES.includes(type);
}

/** True for the single-control family (CNOT, CY, CZ, CH, CS, CT). */
export function isTwoQubitControlledGate(type: GateType): boolean {
  return TWO_QUBIT_CONTROLLED_GATE_TYPES.includes(type);
}

/**
 * Control qubits of a controlled gate, in drawing order.
 * Returns an empty array when the gate is not controlled or is malformed.
 */
export function controlsOf(gate: GateQubitFields): number[] {
  if (!isControlledGate(gate.type) || gate.control === undefined) {
    return [];
  }
  if (gate.type === 'CCX') {
    return gate.control2 !== undefined ? [gate.control, gate.control2] : [];
  }
  return [gate.control];
}

/**
 * Get all qubit indices a gate occupies.
 * For controlled gates this is the full inclusive span from the lowest to the
 * highest involved qubit (the vertical line passes through the ones between).
 */
export function getGateQubits(gate: GateQubitFields): number[] {
  if (isControlledGate(gate.type) && gate.target !== undefined) {
    const controls = controlsOf(gate);
    if (controls.length > 0) {
      const involved = [...controls, gate.target];
      const minQubit = Math.min(...involved);
      const maxQubit = Math.max(...involved);
      const qubits: number[] = [];
      for (let q = minQubit; q <= maxQubit; q++) {
        qubits.push(q);
      }
      return qubits;
    }
  }
  return gate.qubit !== undefined ? [gate.qubit] : [];
}
