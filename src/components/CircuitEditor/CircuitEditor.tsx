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

export interface CircuitEditorProps {
  /** Additional CSS class */
  className?: string;
}

export function CircuitEditor({ className = '' }: CircuitEditorProps = {}) {
  const { circuit, updateGates, addQubit, removeQubit, setEditingGate, config } = useQamposer();

  const { qubits, gates } = circuit;

  const [dragOverQubit, setDragOverQubit] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<number | null>(null);
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const [selectedQubitIndex, setSelectedQubitIndex] = useState<number | null>(null);
  const [draggingGateType, setDraggingGateType] = useState<GateType | null>(null);
  const [previewShiftedGates, setPreviewShiftedGates] = useState<
    { id: string; newPosition: number }[]
  >([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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

  // Calculate drop position based on mouse X
  const calculateDropPosition = useCallback(
    (
      mouseX: number,
      qubit: number,
      gateType: GateType
    ): {
      initialPosition: number;
      finalPosition: number;
      shiftedGates: { id: string; newPosition: number }[];
      control?: number;
      control2?: number;
      target?: number;
    } => {
      let closestPos = 0;
      let minDistance = Infinity;
      for (let pos = 0; pos < numPositions; pos++) {
        const distance = Math.abs(columnCenterXs[pos] - mouseX);
        if (distance < minDistance) {
          minDistance = distance;
          closestPos = pos;
        }
      }

      const controlledQubits = controlledDropQubits(gateType, qubit);
      const control = controlledQubits?.control;
      const control2 = controlledQubits?.control2;
      const target = controlledQubits?.target;
      const targetQubits = controlledQubits
        ? getGateQubits({ type: gateType, ...controlledQubits })
        : [qubit];

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

      const tempGate: Gate = {
        id: 'temp',
        type: gateType,
        position: initialPosition,
        ...(controlledQubits ? controlledQubits : { qubit }),
        ...(['RX', 'RY', 'RZ'].includes(gateType) ? { parameter: Math.PI / 2 } : {}),
      };

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

      return { initialPosition, finalPosition, shiftedGates, control, control2, target };
    },
    [columnCenterXs, controlledDropQubits, gates, numPositions]
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

        if (!scrollContainerRef.current || !currentGateType) return;

        // Use scroll container rect + scrollLeft for scroll-independent coordinate
        const containerRect = scrollContainerRef.current.getBoundingClientRect();
        const scrollLeft = scrollContainerRef.current.scrollLeft;
        const mouseX = clientX - containerRect.left + scrollLeft;
        const { finalPosition, shiftedGates } = calculateDropPosition(
          mouseX,
          qubit,
          currentGateType
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
    [draggingGateType, calculateDropPosition]
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
    if (!gateType || !scrollContainerRef.current) return;

    if (gates.length >= config.maxGates) {
      console.warn(`Maximum gate limit (${config.maxGates}) reached`);
      return;
    }

    const containerRect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const mouseX = event.clientX - containerRect.left + scrollLeft;
    const { initialPosition, control, control2, target } = calculateDropPosition(
      mouseX,
      qubit,
      gateType
    );

    const controlledQubits =
      control !== undefined && target !== undefined
        ? { control, ...(control2 !== undefined ? { control2 } : {}), target }
        : null;
    const targetQubits = controlledQubits
      ? getGateQubits({ type: gateType, ...controlledQubits })
      : [qubit];

    const shiftedGates = gates.map((g) => {
      const gateQubits = getGateQubits(g);
      const overlapsQubit = targetQubits.some((q) => gateQubits.includes(q));
      if (overlapsQubit && g.position >= initialPosition) {
        return { ...g, position: g.position + 1 };
      }
      return g;
    });

    const newGate: Gate = {
      id: generateGateId(),
      type: gateType,
      position: initialPosition,
      ...(controlledQubits ? controlledQubits : { qubit }),
      ...(['RX', 'RY', 'RZ'].includes(gateType) ? { parameter: Math.PI / 2 } : {}),
    };

    const updatedGates = compactGates([...shiftedGates, newGate]);
    updateGates(updatedGates);
  };

  const handleGateClick = (gateId: string) => {
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
          onClick={() => handleGateClick(gate.id)}
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
        onClick={() => handleGateClick(gate.id)}
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
            <div className="circuit-editor__lanes">
              {Array.from({ length: qubits }).map((_, qubitIndex) => (
                <div key={qubitIndex} className="circuit-editor__lane">
                  <div className="circuit-editor__lane-line" />

                  <div
                    className="circuit-editor__drop-zone-continuous"
                    onDragOver={(e) => handleDragOver(e, qubitIndex)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, qubitIndex)}
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

// Internal sub-components

interface ControlledGateShapeProps {
  type: GateType;
  /** Control qubit rows (one, or two for CCX) */
  controls: number[];
  /** Target qubit row */
  target: number;
  /** Column centre X in px */
  left: number;
  /** Accent colour; omitted for the drag preview so the grey styling applies */
  color?: string;
  className: string;
  onClick?: () => void;
}

/**
 * Vertical line spanning every lane a controlled gate touches, with a dot on
 * each control row and the target symbol on the target row: the ⊕ circle for
 * CNOT/CCX, a small coloured box with the base letter for CY/CZ/CH/CS/CT.
 * Every element is positioned by absolute qubit row, so controls may sit
 * between or below the target.
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
  const involved = [...controls, target];
  const minQubit = Math.min(...involved);
  const maxQubit = Math.max(...involved);
  const rowTop = (qubit: number) => `${(qubit - minQubit) * QUBIT_HEIGHT}px`;
  const targetLabel = CONTROLLED_TARGET_LABELS[type];

  return (
    <div
      className={className}
      style={{
        left: `${left}px`,
        top: `${minQubit * QUBIT_HEIGHT + QUBIT_HEIGHT / 2}px`,
        height: `${(maxQubit - minQubit) * QUBIT_HEIGHT}px`,
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
      {targetLabel ? (
        <div
          className="circuit-editor__controlled-box"
          style={{ top: rowTop(target), ...(color ? { backgroundColor: color } : {}) }}
        >
          <span className="circuit-editor__controlled-box-label">{targetLabel}</span>
        </div>
      ) : (
        <div className="circuit-editor__controlled-target" style={{ top: rowTop(target) }} />
      )}
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
