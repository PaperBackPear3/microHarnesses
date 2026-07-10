import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStateMachineEnforcement,
  parseStateMachineProfile,
  profileStateMachine,
  resolveRuntimeStateMachine,
  transitionState,
} from "./stateMachine";

test("parseStateMachineEnforcement parses valid values", () => {
  assert.equal(parseStateMachineEnforcement("off"), "off");
  assert.equal(parseStateMachineEnforcement("advisory"), "advisory");
  assert.equal(parseStateMachineEnforcement("strict"), "strict");
  assert.equal(parseStateMachineEnforcement("invalid"), undefined);
});

test("parseStateMachineProfile parses supported profile", () => {
  assert.equal(parseStateMachineProfile("focused-delivery"), "focused-delivery");
  assert.equal(parseStateMachineProfile("other"), undefined);
});

test("resolveRuntimeStateMachine expands profile defaults", () => {
  const resolved = resolveRuntimeStateMachine({ profile: "focused-delivery" });
  assert.ok(resolved);
  assert.equal(resolved?.enforcement, "advisory");
  assert.equal(resolved?.machine.initialState, "focus");
});

test("transitionState resolves configured transitions", () => {
  const profile = profileStateMachine("focused-delivery");
  const transitioned = transitionState(profile.machine, "focus", "llm_has_actions");
  assert.equal(transitioned.state, "act");
  assert.equal(transitioned.changed, true);
});
