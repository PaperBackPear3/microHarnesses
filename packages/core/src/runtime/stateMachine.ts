import { ValidationError } from "../shared/errors";
import type {
  ResolvedRuntimeStateMachine,
  RuntimeStateMachineConfig,
  RuntimeStateMachineDefinition,
  RuntimeStateMachineEnforcement,
  RuntimeStateMachineEvent,
  RuntimeStateMachineNode,
  RuntimeStateMachineProfile,
  RuntimeStateMachineProfileName,
} from "./types";

export const DEFAULT_STATE_MACHINE_PROFILE: RuntimeStateMachineProfileName = "focused-delivery";

export function parseStateMachineEnforcement(
  input: string | undefined,
): RuntimeStateMachineEnforcement | undefined {
  if (!input) return undefined;
  if (input === "off" || input === "advisory" || input === "strict") {
    return input;
  }
  return undefined;
}

export function parseStateMachineProfile(
  input: string | undefined,
): RuntimeStateMachineProfileName | undefined {
  if (!input) return undefined;
  if (input === "focused-delivery") {
    return input;
  }
  return undefined;
}

export function profileStateMachine(
  profile: RuntimeStateMachineProfileName = DEFAULT_STATE_MACHINE_PROFILE,
): RuntimeStateMachineProfile {
  if (profile === "focused-delivery") {
    return {
      name: profile,
      machine: {
        initialState: "focus",
        states: {
          focus: {
            kind: "llm",
            instruction:
              "Stay focused on the goal. Only propose actions that directly advance the goal.",
            transitions: {
              llm_has_actions: "act",
              llm_no_actions: "focus",
              llm_stop: "done",
            },
          },
          act: {
            kind: "action",
            transitions: {
              action_completed: "focus",
              action_completed_stop: "done",
              action_failed: "focus",
              action_limit_reached: "focus",
            },
          },
          done: {
            kind: "terminal",
          },
        },
      },
      defaultEnforcement: "advisory",
    };
  }
  throw new ValidationError(`Unknown state-machine profile "${profile}"`);
}

export function resolveRuntimeStateMachine(
  config: RuntimeStateMachineConfig | undefined,
): ResolvedRuntimeStateMachine | undefined {
  if (!config || config.enabled === false) return undefined;

  const profile = config.profile ? profileStateMachine(config.profile) : undefined;
  const machine = config.machine ?? profile?.machine;
  if (!machine) {
    throw new ValidationError(
      "stateMachine requires either a profile or a custom machine definition",
    );
  }

  const enforcement = config.enforcement ?? profile?.defaultEnforcement ?? "advisory";
  validateMachine(machine);

  return {
    machine,
    enforcement,
    profile: profile?.name,
  };
}

export function transitionState(
  machine: RuntimeStateMachineDefinition,
  fromState: string,
  event: RuntimeStateMachineEvent,
): { state: string; changed: boolean } {
  const node = machine.states[fromState];
  if (!node) {
    throw new ValidationError(`stateMachine current state "${fromState}" does not exist`);
  }
  const target = node.transitions?.[event] ?? node.transitions?.always;
  if (!target) {
    return { state: fromState, changed: false };
  }
  if (!machine.states[target]) {
    throw new ValidationError(
      `stateMachine transition "${fromState}" --${event}--> "${target}" references unknown state`,
    );
  }
  return { state: target, changed: target !== fromState };
}

function validateMachine(machine: RuntimeStateMachineDefinition): void {
  if (!machine.initialState || !machine.states[machine.initialState]) {
    throw new ValidationError(`stateMachine initialState "${machine.initialState}" is invalid`);
  }
  const entries = Object.entries(machine.states);
  if (entries.length === 0) {
    throw new ValidationError("stateMachine requires at least one state");
  }
  for (const [name, state] of entries) {
    validateNode(name, state, machine);
  }
}

function validateNode(
  stateName: string,
  node: RuntimeStateMachineNode,
  machine: RuntimeStateMachineDefinition,
): void {
  if (node.kind !== "llm" && node.kind !== "action" && node.kind !== "terminal") {
    throw new ValidationError(`stateMachine state "${stateName}" has invalid kind`);
  }
  if (!node.transitions) return;
  for (const target of Object.values(node.transitions)) {
    if (!machine.states[target]) {
      throw new ValidationError(
        `stateMachine transition from "${stateName}" references unknown state "${target}"`,
      );
    }
  }
}
