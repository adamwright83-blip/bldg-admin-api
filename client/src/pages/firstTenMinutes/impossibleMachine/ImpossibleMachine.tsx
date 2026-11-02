import type { StoredMachineProgress } from "./machinePersistence";
import type { MachineBusinessAdapter } from "./machineTypes";
import { MachineBoard } from "./MachineBoard";

export interface ImpossibleMachineProps {
  adapter: MachineBusinessAdapter;
  initialProgress?: Partial<StoredMachineProgress> | null;
  children?: React.ReactNode;
}

/**
 * Top-level onboarding game component for THE IMPOSSIBLE MACHINE.
 * Can be mounted inside FirstTenMinutes or rendered standalone with any MachineBusinessAdapter.
 */
export function ImpossibleMachine({ adapter, initialProgress = null, children }: ImpossibleMachineProps) {
  return (
    <MachineBoard adapter={adapter} initialProgress={initialProgress}>
      {children}
    </MachineBoard>
  );
}

export default ImpossibleMachine;
