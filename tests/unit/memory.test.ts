import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  buildSummary,
  eventsPath,
  explain,
  recordAssociation,
  recordRejection
} from "@shopme/grocery-core";

let memoryDir: string;

beforeEach(() => {
  const root = resolve(".test-memory");
  mkdirSync(root, { recursive: true });
  memoryDir = join(root, `ts-${randomUUID()}`);
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  rmSync(memoryDir, { recursive: true, force: true });
});

test("empty memory summary", () => {
  const summary = buildSummary({ base_dir: memoryDir });

  expect(summary.associations).toEqual([]);
  expect(summary.recent_corrections).toEqual([]);
  expect(summary.ignored_events).toBe(0);
});

test("recorded association appears in summary", () => {
  recordAssociation({
    phrase: "D.Yogurts",
    vendor: "waitrose",
    product_id: "123:abc",
    product_name: "Little Yeos Strawberry Yogurts 6x45g",
    search_term: "kids strawberry yogurts",
    timestamp: "2026-05-01T10:00:00Z",
    base_dir: memoryDir
  });

  const summary = buildSummary({ base_dir: memoryDir }) as any;
  const candidate = summary.associations[0].candidates[0];

  expect(summary.associations[0].phrase_key).toBe("d yogurts");
  expect(candidate.product_id).toBe("123:abc");
  expect(candidate.product_name).toBe("Little Yeos Strawberry Yogurts 6x45g");
  expect(candidate.score).toBe(2);
  expect(candidate.search_terms).toEqual(["kids strawberry yogurts"]);
});

test("repeated association increases score", () => {
  for (const timestamp of ["2026-05-01T10:00:00Z", "2026-05-08T10:00:00Z"]) {
    recordAssociation({
      phrase: "d yogurts",
      vendor: "waitrose",
      product_id: "123:abc",
      product_name: "Little Yeos Strawberry Yogurts 6x45g",
      source: "accepted_suggestion",
      timestamp,
      base_dir: memoryDir
    });
  }

  const summary = buildSummary({ base_dir: memoryDir }) as any;
  const candidate = summary.associations[0].candidates[0];

  expect(candidate.score).toBe(3);
  expect(candidate.evidence_count).toBe(2);
  expect(candidate.last_seen).toBe("2026-05-08T10:00:00Z");
});

test("rejection pushes bad candidate out of summary", () => {
  recordAssociation({
    phrase: "cuke",
    vendor: "waitrose",
    product_id: "coke-id",
    product_name: "Coca-Cola Original Taste 2L",
    timestamp: "2026-05-01T10:00:00Z",
    base_dir: memoryDir
  });
  recordRejection({
    phrase: "cuke",
    vendor: "waitrose",
    wrong_product_id: "coke-id",
    wrong_product_name: "Coca-Cola Original Taste 2L",
    correct_product_id: "cuke-id",
    correct_product_name: "Essential Cucumber Each",
    timestamp: "2026-05-01T10:05:00Z",
    base_dir: memoryDir
  });

  const summary = buildSummary({ base_dir: memoryDir }) as any;
  const candidates = summary.associations[0].candidates;

  expect(candidates[0].product_id).toBe("cuke-id");
  expect(candidates.every((candidate: any) => candidate.product_id !== "coke-id")).toBe(true);
  expect(summary.recent_corrections[0].avoid).toBe("Coca-Cola Original Taste 2L");
});

test("vendor filter keeps associations separate", () => {
  recordAssociation({
    phrase: "bagels",
    vendor: "waitrose",
    product_id: "waitrose-id",
    product_name: "Waitrose Bagels",
    timestamp: "2026-05-01T10:00:00Z",
    base_dir: memoryDir
  });
  recordAssociation({
    phrase: "bagels",
    vendor: "sainsburys",
    product_id: "sainsburys-id",
    product_name: "Sainsbury Bagels",
    timestamp: "2026-05-01T10:01:00Z",
    base_dir: memoryDir
  });

  const summary = buildSummary({ vendor: "sainsburys", base_dir: memoryDir }) as any;

  expect(summary.associations).toHaveLength(1);
  expect(summary.associations[0].vendor).toBe("sainsburys");
  expect(summary.associations[0].candidates[0].product_id).toBe("sainsburys-id");
});

test("explain matches normalized phrase", () => {
  recordAssociation({
    phrase: "D.Yogurts",
    vendor: "waitrose",
    product_id: "123:abc",
    product_name: "Little Yeos Strawberry Yogurts 6x45g",
    timestamp: "2026-05-01T10:00:00Z",
    base_dir: memoryDir
  });

  const explanation = explain("d yogurts", { vendor: "waitrose", base_dir: memoryDir }) as any;

  expect(explanation.phrase_key).toBe("d yogurts");
  expect(explanation.matches[0].candidates[0].product_id).toBe("123:abc");
});

test("corrupt memory lines are ignored", () => {
  writeFileSync(
    eventsPath(memoryDir),
    [
      "not json",
      JSON.stringify({
        event: "resolved",
        phrase: "broken",
        vendor: "waitrose",
        source: "manual",
        timestamp: "2026-05-01T09:00:00Z"
      }),
      JSON.stringify({
        event: "resolved",
        phrase: "milk",
        vendor: "waitrose",
        product_id: "milk-id",
        product_name: "Semi Skimmed Milk",
        source: "manual",
        timestamp: "2026-05-01T10:00:00Z"
      })
    ].join("\n"),
    "utf8"
  );

  const summary = buildSummary({ base_dir: memoryDir }) as any;

  expect(summary.ignored_events).toBe(2);
  expect(summary.associations[0].phrase_key).toBe("milk");
});
