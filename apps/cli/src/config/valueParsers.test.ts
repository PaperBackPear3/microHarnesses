import assert from "node:assert/strict";
import test from "node:test";
import {
  IGNORE_INVALID_PARSE,
  parseIterationLimit,
  parsePositiveInteger,
  parseRatio,
  throwOnInvalid,
} from "./valueParsers.js";

test("parsePositiveInteger validates integer and bounds in throw mode", () => {
  assert.equal(parsePositiveInteger("42", throwOnInvalid("--max-tokens")), 42);
  assert.throws(
    () => parsePositiveInteger("0", throwOnInvalid("--max-tokens")),
    /--max-tokens must be a positive integer/,
  );
  assert.throws(
    () => parsePositiveInteger("1.5", throwOnInvalid("--max-tokens")),
    /--max-tokens must be a positive integer/,
  );
});

test("parsePositiveInteger ignores invalid values in ignore mode", () => {
  assert.equal(parsePositiveInteger(undefined, IGNORE_INVALID_PARSE), undefined);
  assert.equal(parsePositiveInteger("", IGNORE_INVALID_PARSE), undefined);
  assert.equal(parsePositiveInteger("0", IGNORE_INVALID_PARSE), undefined);
});

test("parseIterationLimit accepts unlimited and validates numeric values", () => {
  assert.equal(parseIterationLimit("unlimited", throwOnInvalid("--iterations")), "unlimited");
  assert.equal(parseIterationLimit("32", throwOnInvalid("--iterations")), 32);
  assert.throws(
    () => parseIterationLimit("0", throwOnInvalid("--iterations")),
    /--iterations must be a positive integer/,
  );
});

test("parseRatio validates bounds in throw mode", () => {
  assert.equal(parseRatio("0", throwOnInvalid("--compaction-trigger")), 0);
  assert.equal(parseRatio("1", throwOnInvalid("--compaction-trigger")), 1);
  assert.equal(parseRatio("0.85", throwOnInvalid("--compaction-trigger")), 0.85);
  assert.throws(
    () => parseRatio("-0.1", throwOnInvalid("--compaction-trigger")),
    /--compaction-trigger must be a number between 0 and 1/,
  );
  assert.throws(
    () => parseRatio("1.0001", throwOnInvalid("--compaction-trigger")),
    /--compaction-trigger must be a number between 0 and 1/,
  );
});

test("parseRatio ignores invalid values in ignore mode", () => {
  assert.equal(parseRatio(undefined, IGNORE_INVALID_PARSE), undefined);
  assert.equal(parseRatio("abc", IGNORE_INVALID_PARSE), undefined);
  assert.equal(parseRatio("-1", IGNORE_INVALID_PARSE), undefined);
  assert.equal(parseRatio("2", IGNORE_INVALID_PARSE), undefined);
});
