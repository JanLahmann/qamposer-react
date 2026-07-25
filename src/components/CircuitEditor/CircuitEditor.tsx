import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useQamposer } from '../../hooks/useQamposer';
import { useCircuitKeyboard } from '../../hooks/useCircuitKeyboard';
import { compactGates, generateGateId } from '../../utils/openqasm';
import {
  CONTROLLED_TARGET_LABELS,
  controlsOf,
  getGateQubits,
  isControlledGate,
} from '../../utils/gates';
import { CursorOverlay } from '../CursorOverlay';
import { StatusBar } from '../StatusBar';
import type { Gate, GateType } from '../../types';
import './CircuitEditor.scss';

const GATE_COLORS: Record<GateType, string> = {
  H: '#fa4d56',
  X: '#002d9c',
  Y: '#9f1853',
  Z: '#33b1ff',
  S: '#33b1ff',
  T: '#33b1ff',
  RX: '#9f1853',
  RY: '#9f1853',
  RZ: '#33b1ff',
  CNOT: '#002d9c',
  CY: '#9f1853',
  CZ: '#33b1ff',
  CH: '#fa4d56',
  CS: '#33b1ff',
  CT: '#33b1ff',
  CCX: '#002d9c',
};

/** Gate types that open the qubit-assignment editor. */
const EDITABLE_GATE_TYPES: GateType[] = [
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

const QUBIT_HEIGHT = 80;
const MIN_POSITIONS = 20;
const COLUMN_GAP = 20;
const MIN_LEFT_MARGIN = 16;

/** Rotation gates get this default angle when placed by drag or tap. */
const DEFAULT_ROTATION_PARAMETER = Math.PI / 2;
const ROTATION_GATE_TYPES: GateType[] = ['RX', 'RY', 'RZ'];

/**
 * Extra vertical stub drawn below the last control of a pending (tap-placed)
 * controlled gate, so the hint line stays visible before a target is chosen.
 */
const PENDING_HINT_STUB = QUBIT_HEIGHT / 2;

/**
 * Which qubits a gate occupies, in the shape `Gate` expects: either a single
 * `qubit` or the control/target roles of a controlled gate.
 */
type GateRoles =
  { qubit: number } | { control: number; control2?: number; target: number; qubit?: undefined };

/** Multi-tap placement in progress: column locked, controls collected so far. */
interface PendingTouchPlacement {
  /** Canvas X of the first tap — replayed so the column snaps identically. */
  canvasX: number;
  /** Snapped column, for rendering the pending indicator. */
  column: number;
  /** Control rows tapped so far (1 for CNOT-likes, up to 2 for CCX). */
  controls: number[];
}

export interface CircuitEditorProps {
  /** Additional CSS class */
  className?: string;
}

export function CircuitEditor({ className = '' }: CircuitEditorProps = {}) {
  const {
    circuit,
    updateGates,
    addQubit,
    removeQubit,
    setEditingGate,
    config,
    armedGateType,
    setArmedGateType,
  } = useQamposer();

  const { qubits, gates } = circuit;

  const [dragOverQubit, setDragOverQubit] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<number | null>(null);
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const [selectedQubitIndex, setSelectedQubitIndex] = useState<number | null>(null);
  const [draggingGateType, setDraggingGateType] = useState<GateType | null>(null);
  const [pendingTouch, setPendingTouch] = useState<PendingTouchPlacement | null>(null);
  const [previewShiftedGates, setPreviewShiftedGates] = useState<
    { id: string; newPosition: number }[]
  >([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastDropPositionRef = useRef<{ qubit: number; position: number } | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Dynamic number of columns: at least MIN_POSITIONS, or enough for all gates + 2 extra
  const maxGatePos = gates.length > 0 ? Math.max(...gates.map((g) => g.position)) : 0;
  const numPositions = Math.max(MIN_POSITIONS, maxGatePos + 3);

  // Calculate column widths based on gate content
  const columnWidths = useMemo(() => {
    const widths: Record<number, number> = {};

    for (let pos = 0; pos < numPositions; pos++) {
      let maxWidth = 32;

      gates.forEach((g) => {
        if (g.position === pos) {
          if (['RX', 'RY', 'RZ'].includes(g.type) && g.parameter !== undefined) {
            const parameterLabel = `(${(g.parameter / Math.PI).toFixed(2)}π)`;
            const gateTypeWidth = 32;
            const paramWidth = parameterLabel.length * 6;
            const padding = 16;
            const estimatedWidth = Math.max(gateTypeWidth, paramWidth) + padding;
            maxWidth = Math.max(maxWidth, estimatedWidth);
          } else if (!isControlledGate(g.type)) {
            maxWidth = Math.max(maxWidth, 32);
          }
        }
      });

      widths[pos] = maxWidth;
    }

    return widths;
  }, [gates, numPositions]);

  // Calculate left X positions for each column
  const columnLeftXs = useMemo(() => {
    const leftXs: Record<number, number> = {};

    for (let pos = 0; pos < numPositions; pos++) {
      if (pos === 0) {
        leftXs[pos] = MIN_LEFT_MARGIN;
      } else {
        const prevLeftX = leftXs[pos - 1];
        const prevWidth = columnWidths[pos - 1];
        const prevRightEdge = prevLeftX + prevWidth;
        leftXs[pos] = prevRightEdge + COLUMN_GAP;
      }
    }

    return leftXs;
  }, [columnWidths, numPositions]);

  // Calculate center X positions for each column
  const columnCenterXs = useMemo(() => {
    const centerXs: Record<number, number> = {};

    for (let pos = 0; pos < numPositions; pos++) {
      centerXs[pos] = columnLeftXs[pos] + columnWidths[pos] / 2;
    }

    return centerXs;
  }, [columnLeftXs, columnWidths, numPositions]);

  // Keyboard navigation
  const { cursor, interactionState, inputSource } = useCircuitKeyboard({
    circuit,
    updateGates,
    containerRef: scrollContainerRef,
    numPositions,
    columnLeftXs,
    columnWidths,
  });

  // Clear gate selection when keyboard becomes active
  useEffect(() => {
    if (inputSource === 'keyboard') {
      setSelectedGateId(null);
      setSelectedQubitIndex(null);
    }
  }, [inputSource]);

  // Arming (or disarming) a palette gate resets any half-finished multi-tap and
  // hides the selection toolbars — tap-to-place owns the canvas while armed.
  useEffect(() => {
    setPendingTouch(null);
    if (armedGateType) {
      setSelectedGateId(null);
      setSelectedQubitIndex(null);
    }
  }, [armedGateType]);

  // Escape cancels tap-to-place (pending controls first, then the armed gate).
  useEffect(() => {
    if (!armedGateType) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPendingTouch(null);
      setArmedGateType(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [armedGateType, setArmedGateType]);

  // Default qubit assignment when a controlled gate is dropped on a lane:
  // the gate is anchored at the drop lane and extends downwards, clamped so it
  // still fits inside the register.
  const controlledDropQubits = useCallback(
    (
      gateType: GateType,
      qubit: number
    ): { control: number; control2?: number; target: number } | null => {
      if (gateType === 'CCX') {
        const control = Math.min(qubit, qubits - 3);
        return { control, control2: control + 1, target: control + 2 };
      }
      if (isControlledGate(gateType)) {
        const control = Math.min(qubit, qubits - 2);
        return { control, target: control + 1 };
      }
      return null;
    },
    [qubits]
  );

  /** Column whose centre is nearest to a canvas-space X coordinate. */
  const snapColumn = useCallback(
    (canvasX: number): number => {
      let closestPos = 0;
      let minDistance = Infinity;
      for (let pos = 0; pos < numPositions; pos++) {
        const distance = Math.abs(columnCenterXs[pos] - canvasX);
        if (distance < minDistance) {
          minDistance = distance;
          closestPos = pos;
        }
      }
      return closestPos;
    },
    [columnCenterXs, numPositions]
  );

  /**
   * Where a gate lands for a given canvas X and set of qubit roles: the snapped
   * column, the position after insert-shifting and compaction, and which
   * existing gates move. Shared by the drag preview, the drop handler and
   * tap-to-place so all three snap and shift identically.
   */
  const planPlacement = useCallback(
    (
      canvasX: number,
      gateType: GateType,
      roles: GateRoles
    ): {
      initialPosition: number;
      finalPosition: number;
      shiftedGates: { id: string; newPosition: number }[];
    } => {
      const closestPos = snapColumn(canvasX);
      const targetQubits = getGateQubits({ type: gateType, ...roles });

      const rightWall = gates
        .filter((g) => {
          if (!isControlledGate(g.type) || g.control === undefined || g.target === undefined) {
            return false;
          }
          const gateQubits = getGateQubits(g);
          return targetQubits.some((q) => gateQubits.includes(q)) && g.position > closestPos;
        })
        .sort((a, b) => a.position - b.position)[0];

      let initialPosition: number;
      if (rightWall) {
        initialPosition = Math.min(closestPos, rightWall.position - 1);
      } else {
        initialPosition = closestPos;
      }
      initialPosition = Math.max(0, initialPosition);

      const shiftedGatesForInsert = gates.map((g) => {
        const gateQubits = getGateQubits(g);
        const overlapsQubit = targetQubits.some((q) => gateQubits.includes(q));
        if (overlapsQubit && g.position >= initialPosition) {
          return { ...g, position: g.position + 1 };
        }
        return g;
      });

      const tempGate: Gate = { ...buildGate(gateType, initialPosition, roles), id: 'temp' };

      const compacted = compactGates([...shiftedGatesForInsert, tempGate]);
      const finalGate = compacted.find((g) => g.id === 'temp');
      const finalPosition = finalGate ? finalGate.position : initialPosition;

      const shiftedGates: { id: string; newPosition: number }[] = [];
      compacted.forEach((compactedGate) => {
        if (compactedGate.id === 'temp') return;
        const originalGate = gates.find((g) => g.id === compactedGate.id);
        if (originalGate && originalGate.position !== compactedGate.position) {
          shiftedGates.push({
            id: compactedGate.id,
            newPosition: compactedGate.position,
          });
        }
      });

      return { initialPosition, finalPosition, shiftedGates };
    },
    [gates, snapColumn]
  );

  /**
   * Default roles for a gate dropped/tapped on a single lane: the lane itself
   * for single-qubit gates, the downward-extending span for controlled ones.
   */
  const rolesForLane = useCallback(
    (gateType: GateType, qubit: number): GateRoles =>
      controlledDropQubits(gateType, qubit) ?? { qubit },
    [controlledDropQubits]
  );

  /** Canvas-space X (scroll-independent) for a pointer's clientX. */
  const toCanvasX = useCallback((clientX: number): number | null => {
    const container = scrollContainerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    return clientX - containerRect.left + container.scrollLeft;
  }, []);

  /**
   * Insert a new gate at the column `canvasX` snaps to, shifting and compacting
   * exactly as a drop does. Used by both the drop handler and tap-to-place.
   */
  const commitPlacement = useCallback(
    (canvasX: number, gateType: GateType, roles: GateRoles) => {
      if (gates.length >= config.maxGates) {
        console.warn(`Maximum gate limit (${config.maxGates}) reached`);
        return;
      }

      const { initialPosition } = planPlacement(canvasX, gateType, roles);
      const targetQubits = getGateQubits({ type: gateType, ...roles });

      const shiftedGates = gates.map((g) => {
        const gateQubits = getGateQubits(g);
        const overlapsQubit = targetQubits.some((q) => gateQubits.includes(q));
        if (overlapsQubit && g.position >= initialPosition) {
          return { ...g, position: g.position + 1 };
        }
        return g;
      });

      const newGate = buildGate(gateType, initialPosition, roles);
      updateGates(compactGates([...shiftedGates, newGate]));
    },
    [config.maxGates, gates, planPlacement, updateGates]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent, qubit: number) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';

      let gateType: GateType | null = draggingGateType;
      if (!gateType) {
        const mimeType = event.dataTransfer.types.find((t) => t.startsWith('application/x-gate-'));
        if (mimeType) {
          gateType = mimeType.replace('application/x-gate-', '').toUpperCase() as GateType;
          setDraggingGateType(gateType);
        }
      }

      // Capture values before rAF callback (event may be reused)
      const clientX = event.clientX;
      const currentGateType = gateType;

      // Cancel any pending rAF to avoid stacking
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        if (!currentGateType) return;

        // Use scroll container rect + scrollLeft for scroll-independent coordinate
        const mouseX = toCanvasX(clientX);
        if (mouseX === null) return;
        const { finalPosition, shiftedGates } = planPlacement(
          mouseX,
          currentGateType,
          rolesForLane(currentGateType, qubit)
        );

        // Stability check: skip setState if position hasn't changed
        const last = lastDropPositionRef.current;
        if (last && last.qubit === qubit && last.position === finalPosition) {
          return;
        }

        lastDropPositionRef.current = { qubit, position: finalPosition };
        setDragOverQubit(qubit);
        setDragOverPosition(finalPosition);
        setPreviewShiftedGates(shiftedGates);
      });
    },
    [draggingGateType, planPlacement, rolesForLane, toCanvasX]
  );

  const handleDragLeave = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastDropPositionRef.current = null;
    setDragOverQubit(null);
    setDragOverPosition(null);
    setPreviewShiftedGates([]);
  };

  const handleDragEnd = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastDropPositionRef.current = null;
    setDragOverQubit(null);
    setDragOverPosition(null);
    setPreviewShiftedGates([]);
    setDraggingGateType(null);
  };

  const handleDrop = (event: React.DragEvent, qubit: number) => {
    event.preventDefault();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastDropPositionRef.current = null;
    setDragOverQubit(null);
    setDragOverPosition(null);
    setDraggingGateType(null);
    setPreviewShiftedGates([]);

    const gateType = event.dataTransfer.getData('gateType') as GateType;
    if (!gateType) return;

    const mouseX = toCanvasX(event.clientX);
    if (mouseX === null) return;

    commitPlacement(mouseX, gateType, rolesForLane(gateType, qubit));
  };

  // === Tap-to-place ===

  /** How many control rows the armed gate still collects before its target. */
  const requiredControls = armedGateType === 'CCX' ? 2 : 1;

  /**
   * A tap on a wire while a palette gate is armed. Single-qubit gates place
   * immediately; controlled gates collect control rows first, with the column
   * locked by the very first tap.
   */
  const handleWireTap = (clientX: number, qubit: number) => {
    if (!armedGateType) return;
    const gateType = armedGateType;

    if (!isControlledGate(gateType)) {
      const canvasX = toCanvasX(clientX);
      if (canvasX === null) return;
      commitPlacement(canvasX, gateType, { qubit });
      setArmedGateType(null);
      return;
    }

    if (!pendingTouch) {
      const canvasX = toCanvasX(clientX);
      if (canvasX === null) return;
      setPendingTouch({ canvasX, column: snapColumn(canvasX), controls: [qubit] });
      return;
    }

    // Re-tapping a row already used by this gate is a no-op, not a mistake.
    if (pendingTouch.controls.includes(qubit)) return;

    if (pendingTouch.controls.length < requiredControls) {
      setPendingTouch({ ...pendingTouch, controls: [...pendingTouch.controls, qubit] });
      return;
    }

    const [control, control2] = pendingTouch.controls;
    const roles: GateRoles =
      control2 !== undefined ? { control, control2, target: qubit } : { control, target: qubit };

    commitPlacement(pendingTouch.canvasX, gateType, roles);
    setPendingTouch(null);
    setArmedGateType(null);
  };

  /** Qubit row under a pointer's clientY, or null when outside the lanes. */
  const qubitFromClientY = (clientY: number): number | null => {
    const lanes = lanesRef.current;
    if (!lanes) return null;
    const row = Math.floor((clientY - lanes.getBoundingClientRect().top) / QUBIT_HEIGHT);
    return row >= 0 && row < qubits ? row : null;
  };

  const handleGateClick = (gateId: string, event: React.MouseEvent) => {
    // While armed, a tap on a placed gate places too — selection stays suppressed.
    if (armedGateType) {
      const qubit = qubitFromClientY(event.clientY);
      if (qubit !== null) handleWireTap(event.clientX, qubit);
      return;
    }
    setSelectedGateId(selectedGateId === gateId ? null : gateId);
    setSelectedQubitIndex(null);
  };

  const handleGateDelete = (gateId: string) => {
    const remainingGates = gates.filter((g) => g.id !== gateId);
    const compactedGates = compactGates(remainingGates);
    updateGates(compactedGates);
    setSelectedGateId(null);
  };

  const handleGateEdit = (gate: Gate) => {
    setEditingGate(gate);
    setSelectedGateId(null);
  };

  const handleQubitClick = (qubitIndex: number) => {
    setSelectedQubitIndex(selectedQubitIndex === qubitIndex ? null : qubitIndex);
    setSelectedGateId(null);
  };

  const handleQubitAdd = () => {
    addQubit();
    setSelectedQubitIndex(null);
  };

  const handleQubitRemove = () => {
    if (selectedQubitIndex === null) return;
    removeQubit(selectedQubitIndex);
    setSelectedQubitIndex(null);
  };

  const renderGate = (gate: Gate) => {
    const isSelected = selectedGateId === gate.id;

    if (isControlledGate(gate.type) && gate.target !== undefined) {
      const controls = controlsOf(gate);
      if (controls.length === 0) return null;

      return (
        <ControlledGateShape
          key={gate.id}
          type={gate.type}
          controls={controls}
          target={gate.target}
          left={columnCenterXs[gate.position]}
          color={GATE_COLORS[gate.type]}
          className={`circuit-editor__controlled ${
            isSelected ? 'circuit-editor__controlled--selected' : ''
          }`}
          onClick={(event) => handleGateClick(gate.id, event)}
        />
      );
    }

    if (gate.qubit === undefined) return null;

    const isRotationGate = ['RX', 'RY', 'RZ'].includes(gate.type);
    const parameterLabel =
      gate.parameter !== undefined ? `(${(gate.parameter / Math.PI).toFixed(2)}π)` : '';

    const centerX = columnCenterXs[gate.position];

    return (
      <div
        key={gate.id}
        className={`circuit-editor__gate ${
          isSelected ? 'circuit-editor__gate--selected' : ''
        } ${isRotationGate ? 'circuit-editor__gate--rotation' : ''}`}
        style={{
          left: `${centerX}px`,
          top: `${gate.qubit * QUBIT_HEIGHT + QUBIT_HEIGHT / 2}px`,
          backgroundColor: GATE_COLORS[gate.type],
        }}
        onClick={(event) => handleGateClick(gate.id, event)}
      >
        <span className="circuit-editor__gate-label">
          {gate.type}
          {isRotationGate && gate.parameter !== undefined && (
            <span className="circuit-editor__gate-param">{parameterLabel}</span>
          )}
        </span>
      </div>
    );
  };

  const selectedGate = selectedGateId ? gates.find((g) => g.id === selectedGateId) : null;
  // Toolbar anchors on the topmost lane the gate occupies
  const selectedGateTopQubit = selectedGate ? (getGateQubits(selectedGate)[0] ?? 0) : 0;

  // Calculate the required width for all gates
  // Always include space for one more column after the last gate to prevent edge oscillation
  const nextPos = maxGatePos + 1;
  const nextColumnRightEdge = columnLeftXs[nextPos] + columnWidths[nextPos] + COLUMN_GAP;
  const minCircuitWidth = Math.max(nextColumnRightEdge, 400);

  return (
    <div className={`circuit-editor ${className}`.trim()} onDragEnd={handleDragEnd}>
      {/* Tap-to-place guidance; only shown while a palette gate is armed */}
      {armedGateType && (
        <div className="circuit-editor__touch-hint" role="status">
          {touchHint(armedGateType, pendingTouch, requiredControls)}
        </div>
      )}

      <div className="circuit-editor__canvas">
        {/* Fixed qubit labels - outside scroll area */}
        <div className="circuit-editor__labels">
          {Array.from({ length: qubits }).map((_, qubitIndex) => (
            <div
              key={qubitIndex}
              className={`circuit-editor__lane-label ${
                selectedQubitIndex === qubitIndex ? 'circuit-editor__lane-label--selected' : ''
              }`}
              onClick={() => handleQubitClick(qubitIndex)}
            >
              q[{qubitIndex}]
            </div>
          ))}
          <div className="circuit-editor__lane-label circuit-editor__lane-label--classical">
            c{qubits}
          </div>
        </div>

        {/* Scrollable circuit area */}
        <div className="circuit-editor__scroll-container" ref={scrollContainerRef} tabIndex={0}>
          <div
            className="circuit-editor__circuit-area"
            style={{ minWidth: `${minCircuitWidth}px` }}
          >
            {/* Qubit lanes */}
            <div className="circuit-editor__lanes" ref={lanesRef}>
              {Array.from({ length: qubits }).map((_, qubitIndex) => (
                <div key={qubitIndex} className="circuit-editor__lane">
                  <div className="circuit-editor__lane-line" />

                  <div
                    className="circuit-editor__drop-zone-continuous"
                    onDragOver={(e) => handleDragOver(e, qubitIndex)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, qubitIndex)}
                    onClick={(e) => handleWireTap(e.clientX, qubitIndex)}
                  />
                </div>
              ))}

              {/* Classical register lane */}
              <div className="circuit-editor__lane circuit-editor__lane--classical">
                <div className="circuit-editor__lane-line circuit-editor__lane-line--classical" />
              </div>
            </div>

            {/* Gates */}
            <div className="circuit-editor__gates">
              {gates
                .filter((gate) => {
                  const isBeingShifted = previewShiftedGates.some((sg) => sg.id === gate.id);
                  return !isBeingShifted;
                })
                .map(renderGate)}
            </div>

            {/* Keyboard cursor overlay */}
            <CursorOverlay
              cursor={cursor}
              interactionState={interactionState}
              inputSource={inputSource}
              columnCenterXs={columnCenterXs}
            />

            {/* New gate drop preview */}
            {dragOverQubit !== null && dragOverPosition !== null && draggingGateType && (
              <div className="circuit-editor__preview">
                {isControlledGate(draggingGateType) ? (
                  (() => {
                    const previewQubits = controlledDropQubits(draggingGateType, dragOverQubit);
                    if (!previewQubits) return null;
                    return (
                      <ControlledGateShape
                        type={draggingGateType}
                        controls={controlsOf({ type: draggingGateType, ...previewQubits })}
                        target={previewQubits.target}
                        left={columnCenterXs[dragOverPosition]}
                        className="circuit-editor__controlled circuit-editor__controlled--preview"
                      />
                    );
                  })()
                ) : (
                  <div
                    className="circuit-editor__gate circuit-editor__gate--preview"
                    style={{
                      left: `${columnCenterXs[dragOverPosition]}px`,
                      top: `${dragOverQubit * QUBIT_HEIGHT + QUBIT_HEIGHT / 2}px`,
                    }}
                  >
                    <span className="circuit-editor__gate-label">
                      {draggingGateType}
                      {['RX', 'RY', 'RZ'].includes(draggingGateType) && (
                        <span className="circuit-editor__gate-param">(0.50π)</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Pending tap-to-place controls (control dot(s) + hint line) */}
            {armedGateType && pendingTouch && (
              <div className="circuit-editor__preview">
                <ControlledGateShape
                  type={armedGateType}
                  controls={pendingTouch.controls}
                  left={columnCenterXs[pendingTouch.column]}
                  className="circuit-editor__controlled circuit-editor__controlled--preview circuit-editor__controlled--pending"
                />
              </div>
            )}

            {/* Shifted gates preview */}
            {previewShiftedGates.length > 0 && (
              <div className="circuit-editor__preview circuit-editor__preview--shifted">
                {previewShiftedGates.map((shiftedGate) => {
                  const originalGate = gates.find((g) => g.id === shiftedGate.id);
                  if (!originalGate) return null;

                  if (isControlledGate(originalGate.type) && originalGate.target !== undefined) {
                    const controls = controlsOf(originalGate);
                    if (controls.length === 0) return null;
                    return (
                      <ControlledGateShape
                        key={shiftedGate.id}
                        type={originalGate.type}
                        controls={controls}
                        target={originalGate.target}
                        left={columnCenterXs[shiftedGate.newPosition]}
                        color={GATE_COLORS[originalGate.type]}
                        className="circuit-editor__controlled circuit-editor__controlled--shifted-preview"
                      />
                    );
                  }

                  if (originalGate.qubit === undefined) return null;

                  const isRotationGate = ['RX', 'RY', 'RZ'].includes(originalGate.type);
                  const parameterLabel =
                    originalGate.parameter !== undefined
                      ? `(${(originalGate.parameter / Math.PI).toFixed(2)}π)`
                      : '';

                  return (
                    <div
                      key={shiftedGate.id}
                      className={`circuit-editor__gate circuit-editor__gate--shifted-preview ${
                        isRotationGate ? 'circuit-editor__gate--rotation' : ''
                      }`}
                      style={{
                        left: `${columnCenterXs[shiftedGate.newPosition]}px`,
                        top: `${originalGate.qubit * QUBIT_HEIGHT + QUBIT_HEIGHT / 2}px`,
                        backgroundColor: GATE_COLORS[originalGate.type],
                      }}
                    >
                      <span className="circuit-editor__gate-label">
                        {originalGate.type}
                        {isRotationGate && originalGate.parameter !== undefined && (
                          <span className="circuit-editor__gate-param">{parameterLabel}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Gate Toolbar */}
            {selectedGate && (
              <GateToolbar
                gate={selectedGate}
                position={{
                  top: selectedGateTopQubit * QUBIT_HEIGHT + QUBIT_HEIGHT / 2,
                  left: columnCenterXs[selectedGate.position],
                }}
                showBelow={selectedGateTopQubit === 0}
                onEdit={
                  EDITABLE_GATE_TYPES.includes(selectedGate.type)
                    ? () => handleGateEdit(selectedGate)
                    : undefined
                }
                onDelete={() => handleGateDelete(selectedGate.id)}
              />
            )}

            {/* Qubit Toolbar */}
            {selectedQubitIndex !== null && (
              <QubitToolbar
                position={{
                  top: selectedQubitIndex * QUBIT_HEIGHT + QUBIT_HEIGHT / 2,
                  left: 0,
                }}
                canAdd={qubits < config.maxQubits}
                canRemove={qubits > 1}
                onAddQubit={handleQubitAdd}
                onDeleteQubit={handleQubitRemove}
              />
            )}
          </div>
        </div>

        {/* Measurement icons - fixed at right edge, outside scroll area */}
        <div className="circuit-editor__measurements">
          {Array.from({ length: qubits }).map((_, qubitIndex) => (
            <div
              key={qubitIndex}
              className="circuit-editor__measurement"
              style={{
                top: `${qubitIndex * QUBIT_HEIGHT + QUBIT_HEIGHT / 2}px`,
              }}
            >
              <div className="circuit-editor__measurement-icon" />
            </div>
          ))}
        </div>
      </div>

      {/* Status bar for keyboard mode */}
      <StatusBar interactionState={interactionState} cursor={cursor} inputSource={inputSource} />
    </div>
  );
}

// Internal helpers

/** A brand new gate for `roles`, with the default angle for rotation gates. */
function buildGate(gateType: GateType, position: number, roles: GateRoles): Gate {
  return {
    id: generateGateId(),
    type: gateType,
    position,
    ...roles,
    ...(ROTATION_GATE_TYPES.includes(gateType) ? { parameter: DEFAULT_ROTATION_PARAMETER } : {}),
  };
}

/** Instruction shown while a palette gate is armed for tap-to-place. */
function touchHint(
  gateType: GateType,
  pending: PendingTouchPlacement | null,
  requiredControls: number
): string {
  if (!pending) return `Tap a wire to place ${gateType}`;
  if (pending.controls.length < requiredControls) return 'Tap the second control wire';
  return 'Tap the target wire';
}

// Internal sub-components

interface ControlledGateShapeProps {
  type: GateType;
  /** Control qubit rows (one, or two for CCX) */
  controls: number[];
  /** Target qubit row; omitted while a tap-to-place target is still pending */
  target?: number;
  /** Column centre X in px */
  left: number;
  /** Accent colour; omitted for the drag preview so the grey styling applies */
  color?: string;
  className: string;
  onClick?: (event: React.MouseEvent) => void;
}

/**
 * Vertical line spanning every lane a controlled gate touches, with a dot on
 * each control row and the target symbol on the target row: the ⊕ circle for
 * CNOT/CCX, a small coloured box with the base letter for CY/CZ/CH/CS/CT.
 * Every element is positioned by absolute qubit row, so controls may sit
 * between or below the target.
 *
 * With no `target` (a tap-to-place gate that still needs one) only the control
 * dots are drawn, and the line gets a short stub so it stays visible.
 */
function ControlledGateShape({
  type,
  controls,
  target,
  left,
  color,
  className,
  onClick,
}: ControlledGateShapeProps) {
  const involved = target !== undefined ? [...controls, target] : controls;
  const minQubit = Math.min(...involved);
  const maxQubit = Math.max(...involved);
  const spanHeight = (maxQubit - minQubit) * QUBIT_HEIGHT;
  const rowTop = (qubit: number) => `${(qubit - minQubit) * QUBIT_HEIGHT}px`;
  const targetLabel = CONTROLLED_TARGET_LABELS[type];

  return (
    <div
      className={className}
      style={{
        left: `${left}px`,
        top: `${minQubit * QUBIT_HEIGHT + QUBIT_HEIGHT / 2}px`,
        height: `${target !== undefined ? spanHeight : spanHeight + PENDING_HINT_STUB}px`,
      }}
      onClick={onClick}
    >
      <div
        className="circuit-editor__controlled-line"
        style={color ? { background: color } : undefined}
      />
      {controls.map((control) => (
        <div
          key={control}
          className="circuit-editor__controlled-control"
          style={{ top: rowTop(control), ...(color ? { background: color } : {}) }}
        />
      ))}
      {target !== undefined &&
        (targetLabel ? (
          <div
            className="circuit-editor__controlled-box"
            style={{ top: rowTop(target), ...(color ? { backgroundColor: color } : {}) }}
          >
            <span className="circuit-editor__controlled-box-label">{targetLabel}</span>
          </div>
        ) : (
          <div className="circuit-editor__controlled-target" style={{ top: rowTop(target) }} />
        ))}
    </div>
  );
}

interface GateToolbarProps {
  gate: Gate;
  position: { top: number; left: number };
  showBelow?: boolean;
  onEdit?: () => void;
  onDelete: () => void;
}

function GateToolbar({ gate, position, showBelow = false, onEdit, onDelete }: GateToolbarProps) {
  const isEditable = EDITABLE_GATE_TYPES.includes(gate.type);

  return (
    <div
      className={`circuit-editor__toolbar ${showBelow ? 'circuit-editor__toolbar--below' : ''}`}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {isEditable && onEdit && (
        <button
          className="circuit-editor__toolbar-btn"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit operation"
        >
          <EditIcon />
        </button>
      )}
      <button
        className="circuit-editor__toolbar-btn circuit-editor__toolbar-btn--danger"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

interface QubitToolbarProps {
  position: { top: number; left: number };
  canAdd: boolean;
  canRemove: boolean;
  onAddQubit: () => void;
  onDeleteQubit: () => void;
}

function QubitToolbar({
  position,
  canAdd,
  canRemove,
  onAddQubit,
  onDeleteQubit,
}: QubitToolbarProps) {
  return (
    <div
      className="circuit-editor__toolbar circuit-editor__toolbar--qubit"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="circuit-editor__toolbar-btn"
        onClick={(e) => {
          e.stopPropagation();
          onAddQubit();
        }}
        disabled={!canAdd}
        title="Add qubit"
      >
        <AddIcon />
      </button>
      <button
        className="circuit-editor__toolbar-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDeleteQubit();
        }}
        disabled={!canRemove}
        title="Delete qubit"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

// Simple SVG icons (no Carbon dependency)

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.146 0.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
      <path
        fillRule="evenodd"
        d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
      />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"
      />
    </svg>
  );
}
