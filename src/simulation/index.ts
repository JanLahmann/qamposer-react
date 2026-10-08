/**
 * Simulation module. The ideal state-vector functions are also exported from
 * the package root for apps that need exact amplitudes or expectation values
 * (localAdapter only returns sampled counts).
 */

export {
  simulateStatevector,
  probabilities,
  expectationZ,
  DEFAULT_ROTATION_ANGLE,
} from './statevector';
export type { StateVector, SimulationGate } from './statevector';
export { sampleCounts, mulberry32 } from './sampling';
export { computeQspherePoints } from './qsphere';
