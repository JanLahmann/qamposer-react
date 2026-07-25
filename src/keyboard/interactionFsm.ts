import { GATE_CYCLE_ORDER } from './constants';
import { isTwoQubitControlledGate } from '../utils/gates';
import type { GateType } from '../types';
import type {
  InteractionState,
  InteractionAction,
  CursorPosition,
  GridBounds,
  FsmResult,
  CircuitCommand,
} from './types';

/**
 * Pure FSM transition function.
 * No external dependencies — fully unit-testable.
 *
 * Takes current state, cursor, action, and grid bounds.
 * Returns next state, new cursor position, and optional circuit command.
 */
export function interactionFsm(
  state: InteractionState,
  cursor: CursorPosition,
  action: InteractionAction,
  bounds: GridBounds
): FsmResult {
  // --- Global actions (handled regardless of state) ---

  if (action.type === 'MOVE_CURSOR') {
    const newRow = clamp(cursor.row + action.dRow, 0, bounds.maxRow);
    const newCol = clamp(cursor.col + action.dCol, 0, bounds.maxCol);
    return { state, cursor: { row: newRow, col: newCol }, command: null };
  }

  if (action.type === 'DELETE_AT') {
    return {
      state,
      cursor,
      command: { type: 'DELETE_GATE', row: cursor.row, col: cursor.col },
    };
  }

  if (action.type === 'UNDO') {
    return { state, cursor, command: { type: 'UNDO' } };
  }

  if (action.type === 'REDO') {
    return { state, cursor, command: { type: 'REDO' } };
  }

  if (action.type === 'CANCEL') {
    return { state: { type: 'idle' }, cursor, command: null };
  }

  // --- CYCLE_GATE: resolve to SELECT_GATE ---

  if (action.type === 'CYCLE_GATE') {
    const currentGateType = state.type === 'placing' ? state.gateType : null;
    const currentIndex = currentGateType ? GATE_CYCLE_ORDER.indexOf(currentGateType) : -1;
    const len = GATE_CYCLE_ORDER.length;
    const nextIndex =
      currentIndex === -1
        ? action.direction === 1
          ? 0
          : len - 1
        : (currentIndex + action.direction + len) % len;
    const gateType = GATE_CYCLE_ORDER[nextIndex];
    // Recurse with resolved SELECT_GATE
    return interactionFsm(state, cursor, { type: 'SELECT_GATE', gateType }, bounds);
  }

  // --- State-specific transitions ---

  switch (state.type) {
    case 'idle':
      return idleTransition(state, cursor, action);

    case 'placing':
      return placingTransition(state, cursor, action, bounds);

    case 'cnot_control':
      return cnotControlTransition(state, cursor, action);

    case 'cnot_target':
      return cnotTargetTransition(state, cursor, action);
  }
}

function idleTransition(
  state: InteractionState,
  cursor: CursorPosition,
  action: InteractionAction
): FsmResult {
  if (action.type === 'SELECT_GATE') {
    return { state: selectedGateState(action.gateType), cursor, command: null };
  }

  // ACTIVATE_CELL in idle does nothing
  return { state, cursor, command: null };
}

function placingTransition(
  state: Extract<InteractionState, { type: 'placing' }>,
  cursor: CursorPosition,
  action: InteractionAction,
  bounds: GridBounds
): FsmResult {
  if (action.type === 'SELECT_GATE') {
    return { state: selectedGateState(action.gateType), cursor, command: null };
  }

  if (action.type === 'ACTIVATE_CELL') {
    const command: CircuitCommand = {
      type: 'PLACE_GATE',
      gateType: state.gateType,
      row: cursor.row,
      col: cursor.col,
      ...(isRotationGate(state.gateType) ? { parameter: Math.PI / 2 } : {}),
    };
    // Stay in placing for continuous placement, advance cursor right
    const newCol = clamp(cursor.col + 1, 0, bounds.maxCol);
    return {
      state,
      cursor: { row: cursor.row, col: newCol },
      command,
    };
  }

  return { state, cursor, command: null };
}

function cnotControlTransition(
  state: Extract<InteractionState, { type: 'cnot_control' }>,
  cursor: CursorPosition,
  action: InteractionAction
): FsmResult {
  if (action.type === 'SELECT_GATE') {
    // Selecting another controlled gate re-equips it and restarts the flow
    return { state: selectedGateState(action.gateType), cursor, command: null };
  }

  if (action.type === 'ACTIVATE_CELL') {
    return {
      state: { type: 'cnot_target', gateType: state.gateType, controlRow: cursor.row },
      cursor,
      command: null,
    };
  }

  return { state, cursor, command: null };
}

function cnotTargetTransition(
  state: Extract<InteractionState, { type: 'cnot_target' }>,
  cursor: CursorPosition,
  action: InteractionAction
): FsmResult {
  if (action.type === 'SELECT_GATE') {
    // Selecting another controlled gate re-equips it and restarts the flow
    return { state: selectedGateState(action.gateType), cursor, command: null };
  }

  if (action.type === 'ACTIVATE_CELL') {
    // Target must differ from control
    if (cursor.row === state.controlRow) {
      return { state, cursor, command: null };
    }
    const command: CircuitCommand = {
      type: 'PLACE_CONTROLLED',
      gateType: state.gateType,
      controlRow: state.controlRow,
      targetRow: cursor.row,
      col: cursor.col,
    };
    return { state: { type: 'idle' }, cursor, command };
  }

  return { state, cursor, command: null };
}

// --- Helpers ---

/**
 * State entered when a gate is equipped: controlled gates start the two-step
 * control-then-target flow, everything else goes straight to `placing`.
 */
function selectedGateState(gateType: GateType): InteractionState {
  return isTwoQubitControlledGate(gateType)
    ? { type: 'cnot_control', gateType }
    : { type: 'placing', gateType };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRotationGate(gateType: string): boolean {
  return gateType === 'RX' || gateType === 'RY' || gateType === 'RZ';
}
