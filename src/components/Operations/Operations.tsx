import { useState, useEffect } from 'react';
import { useQamposer } from '../../hooks/useQamposer';
import { isControlledGate } from '../../utils/gates';
import type { GateType, Gate, GateInfo } from '../../types';
import './Operations.scss';

const GATE_DEFINITIONS: GateInfo[] = [
  { type: 'H', label: 'H', description: 'Hadamard', category: 'single', color: '#fa4d56' },
  { type: 'X', label: 'X', description: 'Pauli-X (NOT)', category: 'single', color: '#002d9c' },
  { type: 'Y', label: 'Y', description: 'Pauli-Y', category: 'single', color: '#9f1853' },
  { type: 'Z', label: 'Z', description: 'Pauli-Z', category: 'single', color: '#33b1ff' },
  { type: 'S', label: 'S', description: 'Phase S (√Z)', category: 'single', color: '#33b1ff' },
  { type: 'T', label: 'T', description: 'Phase T (√S)', category: 'single', color: '#33b1ff' },
  { type: 'RX', label: 'RX', description: 'Rotate X', category: 'rotation', color: '#9f1853' },
  { type: 'RY', label: 'RY', description: 'Rotate Y', category: 'rotation', color: '#9f1853' },
  { type: 'RZ', label: 'RZ', description: 'Rotate Z', category: 'rotation', color: '#33b1ff' },
  {
    type: 'CNOT',
    label: 'CNOT',
    description: 'Controlled-NOT',
    category: 'multi',
    color: '#002d9c',
  },
  { type: 'CY', label: 'CY', description: 'Controlled-Y', category: 'multi', color: '#9f1853' },
  { type: 'CZ', label: 'CZ', description: 'Controlled-Z', category: 'multi', color: '#33b1ff' },
  { type: 'CH', label: 'CH', description: 'Controlled-H', category: 'multi', color: '#fa4d56' },
  { type: 'CS', label: 'CS', description: 'Controlled-S', category: 'multi', color: '#33b1ff' },
  { type: 'CT', label: 'CT', description: 'Controlled-T', category: 'multi', color: '#33b1ff' },
  {
    type: 'CCX',
    label: 'CCX',
    description: 'Toffoli (CCX)',
    category: 'multi',
    color: '#002d9c',
  },
];

/** Base letter drawn in the target of a boxed controlled gate's palette icon. */
const CONTROLLED_ICON_LABELS: Partial<Record<GateType, string>> = {
  CY: 'Y',
  CZ: 'Z',
  CH: 'H',
  CS: 'S',
  CT: 'T',
};

export interface OperationsProps {
  /** Additional CSS class */
  className?: string;
}

export function Operations({ className = '' }: OperationsProps = {}) {
  const { editingGate, setEditingGate, updateGate } = useQamposer();

  if (editingGate) {
    return (
      <GateEditor
        gate={editingGate}
        onUpdate={updateGate}
        onClose={() => setEditingGate(null)}
        className={className}
      />
    );
  }

  return <GateLibrary className={className} />;
}

// GateLibrary sub-component
function GateLibrary({ className = '' }: { className?: string }) {
  const { circuit } = useQamposer();

  /** Qubits a controlled gate needs: 3 for CCX (two controls), 2 otherwise. */
  const requiredQubits = (gateType: GateType) => (gateType === 'CCX' ? 3 : 2);
  const isGateDisabled = (gateType: GateType) =>
    isControlledGate(gateType) && circuit.qubits < requiredQubits(gateType);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    single: true,
    multi: false,
  });

  const handleDragStart = (event: React.DragEvent, gateType: GateType) => {
    // Prevent dragging a controlled gate onto a register that is too small
    if (isGateDisabled(gateType)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('gateType', gateType);
    event.dataTransfer.setData(`application/x-gate-${gateType.toLowerCase()}`, '');
    event.dataTransfer.effectAllowed = 'copy';
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const renderGate = (gate: GateInfo) => {
    if (isControlledGate(gate.type)) {
      const isDisabled = isGateDisabled(gate.type);
      return (
        <div
          key={gate.type}
          className={`operations__gate operations__gate--cnot ${isDisabled ? 'operations__gate--disabled' : ''}`}
          draggable={!isDisabled}
          onDragStart={(e) => handleDragStart(e, gate.type)}
          title={
            isDisabled
              ? `${gate.type} requires at least ${requiredQubits(gate.type)} qubits`
              : gate.description
          }
        >
          <ControlledGateIcon type={gate.type} color={gate.color} />
        </div>
      );
    }

    return (
      <div
        key={gate.type}
        className="operations__gate"
        draggable
        onDragStart={(e) => handleDragStart(e, gate.type)}
        style={{ backgroundColor: gate.color }}
        title={gate.description}
      >
        <span className="operations__gate-label">{gate.label}</span>
      </div>
    );
  };

  const singleQubitGates = GATE_DEFINITIONS.filter(
    (g) => g.category === 'single' || g.category === 'rotation'
  );
  const multiQubitGates = GATE_DEFINITIONS.filter((g) => g.category === 'multi');

  return (
    <div className={`operations ${className}`.trim()}>
      <div className="operations__header">
        <h3>Operations</h3>
      </div>

      <div className="operations__sections">
        <div className="operations__section">
          <button className="operations__section-header" onClick={() => toggleSection('single')}>
            <ChevronIcon expanded={expandedSections.single} />
            <span>Single-Qubit Gates</span>
          </button>
          {expandedSections.single && (
            <div className="operations__grid">{singleQubitGates.map(renderGate)}</div>
          )}
        </div>

        <div className="operations__section">
          <button className="operations__section-header" onClick={() => toggleSection('multi')}>
            <ChevronIcon expanded={expandedSections.multi} />
            <span>Multi-Qubit Gates</span>
          </button>
          {expandedSections.multi && (
            <div className="operations__grid">{multiQubitGates.map(renderGate)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Palette icon for a controlled gate: control dot(s), a vertical line and the
 * target — the ⊕ circle for CNOT/CCX, a boxed base letter for CY/CZ/CH/CS/CT.
 */
function ControlledGateIcon({ type, color }: { type: GateType; color: string }) {
  const label = CONTROLLED_ICON_LABELS[type];

  if (type === 'CCX') {
    return (
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
        <rect x="0" y="0" width="32" height="32" fill={color} rx="4" />
        <line x1="16" x2="16" y1="5" y2="28" stroke="white" strokeWidth="1.25" />
        <circle cx="16" cy="6" r="2" fill="white" />
        <circle cx="16" cy="13" r="2" fill="white" />
        <circle cx="16" cy="23" r="4.75" stroke="white" fill="none" strokeWidth="1.25" />
        <line x1="11.25" x2="20.75" y1="23" y2="23" stroke="white" strokeWidth="1.25" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect x="0" y="0" width="32" height="32" fill={color} rx="4" />
      <circle cx="16" cy="8" r="2" fill="white" />
      <line x1="16" x2="16" y1="6" y2="26" stroke="white" strokeWidth="1.25" />
      {label ? (
        <>
          <rect x="9.667" y="14.333" width="12.667" height="12.667" fill="white" rx="2" />
          <text
            x="16"
            y="20.667"
            fill={color}
            fontSize="9"
            fontWeight="600"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {label}
          </text>
        </>
      ) : (
        <>
          <circle cx="16" cy="20.667" r="5.333" stroke="white" fill="none" strokeWidth="1.25" />
          <line x1="10.667" x2="21.333" y1="20.667" y2="20.667" stroke="white" strokeWidth="1.25" />
        </>
      )}
    </svg>
  );
}

// GateEditor sub-component
interface GateEditorProps {
  gate: Gate;
  onUpdate: (gateId: string, updates: Partial<Gate>) => void;
  onClose: () => void;
  className?: string;
}

function GateEditor({ gate, onUpdate, onClose, className = '' }: GateEditorProps) {
  const { circuit } = useQamposer();
  const numQubits = circuit.qubits;

  // Rotation gate state
  const [parameterValue, setParameterValue] = useState('');

  // Controlled gate state
  const [controlQubit, setControlQubit] = useState(gate.control ?? 0);
  const [control2Qubit, setControl2Qubit] = useState(gate.control2 ?? 1);
  const [targetQubit, setTargetQubit] = useState(gate.target ?? 1);

  // Initialize rotation parameter
  useEffect(() => {
    if (gate.parameter !== undefined) {
      const value = gate.parameter;
      const piRatio = value / Math.PI;

      if (Math.abs(piRatio - Math.round(piRatio)) < 0.0001) {
        setParameterValue(piRatio === 0 ? '0' : piRatio === 1 ? 'pi' : `${Math.round(piRatio)}*pi`);
      } else if (Math.abs(piRatio * 2 - Math.round(piRatio * 2)) < 0.0001) {
        const ratio = Math.round(piRatio * 2);
        setParameterValue(ratio === 1 ? 'pi/2' : `${ratio}*pi/2`);
      } else {
        setParameterValue(value.toFixed(4));
      }
    } else {
      setParameterValue('0');
    }
  }, [gate.parameter]);

  // Initialize controlled-gate qubits
  useEffect(() => {
    if (isControlledGate(gate.type)) {
      setControlQubit(gate.control ?? 0);
      setControl2Qubit(gate.control2 ?? 1);
      setTargetQubit(gate.target ?? 1);
    }
  }, [gate.type, gate.control, gate.control2, gate.target]);

  const isRotationGate = ['RX', 'RY', 'RZ'].includes(gate.type);
  const isControlledGateType = isControlledGate(gate.type);
  const hasSecondControl = gate.type === 'CCX';

  if (!isRotationGate && !isControlledGateType) {
    return null;
  }

  const involvedQubits = hasSecondControl
    ? [controlQubit, control2Qubit, targetQubit]
    : [controlQubit, targetQubit];
  const hasDuplicateQubits = new Set(involvedQubits).size !== involvedQubits.length;

  const handleRotationSave = () => {
    let radians = 0;
    try {
      const normalized = parameterValue.toLowerCase().replace(/\s/g, '');

      if (normalized.includes('pi')) {
        const piValue = Math.PI;
        let expr = normalized.replace(/pi/g, String(piValue));
        expr = expr.replace(/\*/g, '*').replace(/\//g, '/');
        radians = Function(`"use strict"; return (${expr})`)();
      } else {
        radians = parseFloat(normalized);
      }

      if (!isNaN(radians)) {
        onUpdate(gate.id, { parameter: radians });
      }
    } catch (error) {
      console.error('Invalid parameter expression:', error);
    }
  };

  const handleControlledSave = () => {
    if (!hasDuplicateQubits) {
      onUpdate(gate.id, {
        control: controlQubit,
        target: targetQubit,
        ...(hasSecondControl ? { control2: control2Qubit } : {}),
      });
    }
  };

  const qubitOptions = Array.from({ length: numQubits }, (_, i) => i);

  /** Lowest qubit index not already used by another role of the same gate. */
  const firstFreeQubit = (taken: number[]) =>
    qubitOptions.find((q) => !taken.includes(q)) ?? taken[0];

  return (
    <div className={`operations operations--editor ${className}`.trim()}>
      <div className="operations__header">
        <h3>Edit {gate.type}</h3>
        <button className="operations__close-btn" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="operations__content">
        {isRotationGate && (
          <div className="operations__field">
            <label htmlFor="theta-input">theta (rotation)</label>
            <input
              id="theta-input"
              type="text"
              className="operations__input"
              value={parameterValue}
              onChange={(e) => setParameterValue(e.target.value)}
              onBlur={handleRotationSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRotationSave();
              }}
              placeholder="e.g., pi/2, 1.5708, 2*pi"
            />
            <p className="operations__helper">Enter angle in radians or use pi expressions</p>
          </div>
        )}

        {isControlledGateType && (
          <>
            <div className="operations__field">
              <label htmlFor="control-select">Control qubit</label>
              <select
                id="control-select"
                className="operations__select"
                value={controlQubit}
                onChange={(e) => {
                  const newControl = parseInt(e.target.value, 10);
                  setControlQubit(newControl);
                  // Auto-adjust the other roles if they collide with the control
                  if (newControl === targetQubit) {
                    setTargetQubit(
                      firstFreeQubit(hasSecondControl ? [newControl, control2Qubit] : [newControl])
                    );
                  }
                  if (hasSecondControl && newControl === control2Qubit) {
                    setControl2Qubit(firstFreeQubit([newControl, targetQubit]));
                  }
                }}
              >
                {qubitOptions.map((q) => (
                  <option key={q} value={q}>
                    q[{q}]
                  </option>
                ))}
              </select>
            </div>

            {hasSecondControl && (
              <div className="operations__field">
                <label htmlFor="control2-select">Second control</label>
                <select
                  id="control2-select"
                  className="operations__select"
                  value={control2Qubit}
                  onChange={(e) => {
                    const newControl2 = parseInt(e.target.value, 10);
                    setControl2Qubit(newControl2);
                    // Auto-adjust the other roles if they collide with it
                    if (newControl2 === controlQubit) {
                      setControlQubit(firstFreeQubit([newControl2, targetQubit]));
                    }
                    if (newControl2 === targetQubit) {
                      setTargetQubit(firstFreeQubit([newControl2, controlQubit]));
                    }
                  }}
                >
                  {qubitOptions.map((q) => (
                    <option key={q} value={q}>
                      q[{q}]
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="operations__field">
              <label htmlFor="target-select">Target qubit</label>
              <select
                id="target-select"
                className="operations__select"
                value={targetQubit}
                onChange={(e) => {
                  const newTarget = parseInt(e.target.value, 10);
                  setTargetQubit(newTarget);
                  // Auto-adjust the controls if they collide with the target
                  if (newTarget === controlQubit) {
                    setControlQubit(
                      firstFreeQubit(hasSecondControl ? [newTarget, control2Qubit] : [newTarget])
                    );
                  }
                  if (hasSecondControl && newTarget === control2Qubit) {
                    setControl2Qubit(firstFreeQubit([newTarget, controlQubit]));
                  }
                }}
              >
                {qubitOptions.map((q) => (
                  <option key={q} value={q}>
                    q[{q}]
                  </option>
                ))}
              </select>
            </div>

            <button
              className="operations__apply-btn"
              onClick={handleControlledSave}
              disabled={hasDuplicateQubits}
            >
              Apply
            </button>

            {hasDuplicateQubits && (
              <p className="operations__error">
                {hasSecondControl
                  ? 'Controls and target must be different qubits'
                  : 'Control and target must be different qubits'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Simple icons
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s',
      }}
    >
      <path
        fillRule="evenodd"
        d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"
      />
    </svg>
  );
}
