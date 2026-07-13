import assert from "node:assert/strict";
import test from "node:test";
import { parseAssistantRequest } from "./assistantRequest.js";

const problem = {
  title: "Group Anagrams",
  titleSlug: "group-anagrams",
  questionFrontendId: "49",
  difficulty: "Medium",
  tags: ["Hash Table", "String"],
  link: "https://leetcode.com/problems/group-anagrams/",
  statement: "Group strings that are anagrams of each other.",
  examples: [],
  constraints: []
};

test("accepts a bounded, known assistant request", () => {
  const result = parseAssistantRequest({ mode: "hint", hintLevel: 2, language: "Python", problem });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.mode, "hint");
    assert.equal(result.value.problem?.titleSlug, "group-anagrams");
  }
});

test("rejects unknown modes and fields", () => {
  assert.equal(parseAssistantRequest({ mode: "invented" }).ok, false);
  assert.equal(parseAssistantRequest({ mode: "hint", providerApiKey: "secret" }).ok, false);
});

test("rejects invalid hint levels and oversized code", () => {
  assert.equal(parseAssistantRequest({ mode: "hint", hintLevel: true }).ok, false);
  assert.equal(parseAssistantRequest({ mode: "debug", userCode: "x".repeat(100_001) }).ok, false);
});

test("rejects malformed problem context", () => {
  assert.equal(parseAssistantRequest({ mode: "hint", problem: { ...problem, tags: "Hash Table" } }).ok, false);
  assert.equal(parseAssistantRequest({ mode: "hint", problem: { ...problem, acceptanceRate: 120 } }).ok, false);
});
