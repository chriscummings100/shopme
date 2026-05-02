import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stringifySorted, withoutNullish } from "@chriscummings100/shopme-shared";
import {
  EVENTS_FILE,
  MEMORY_ENV,
  POSITIVE_WEIGHTS,
  REJECTION_WEIGHT,
  SUMMARY_FILE,
  type MemorySource,
  phraseKey,
  productKey
} from "./scoring.js";

export interface MemoryRecordInput {
  phrase: string;
  vendor: string;
  product_id: string;
  product_name: string;
  search_term?: string | null;
  source?: MemorySource;
  size?: string | null;
  price?: string | null;
  timestamp?: string | null;
  base_dir?: string | null;
}

export interface MemoryRejectInput {
  phrase: string;
  vendor: string;
  wrong_product_id?: string | null;
  wrong_product_name?: string | null;
  correct_product_id?: string | null;
  correct_product_name?: string | null;
  source?: string;
  timestamp?: string | null;
  base_dir?: string | null;
}

export interface LoadedEvents {
  events: Record<string, unknown>[];
  ignored: number;
}

interface Candidate {
  product_id: string | null;
  product_name: string | null;
  score: number;
  evidence_count: number;
  reject_count: number;
  last_seen: string | null;
  search_terms: string[];
  sizes: string[];
  prices: string[];
}

interface Group {
  phrase: unknown;
  phrase_key: string;
  vendor: unknown;
  candidates: Map<string, Candidate>;
}

export function memoryDir(): string {
  const override = process.env[MEMORY_ENV];
  if (override) {
    return resolve(override);
  }

  return resolve(process.cwd(), ".shopme-memory");
}

export function eventsPath(baseDir?: string | null): string {
  return join(baseDir ? resolve(baseDir) : memoryDir(), EVENTS_FILE);
}

export function summaryPath(baseDir?: string | null): string {
  return join(baseDir ? resolve(baseDir) : memoryDir(), SUMMARY_FILE);
}

export function loadEvents(baseDir?: string | null): LoadedEvents {
  const path = eventsPath(baseDir);
  if (!existsSync(path)) {
    return { events: [], ignored: 0 };
  }

  const events: Record<string, unknown>[] = [];
  let ignored = 0;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      ignored += 1;
      continue;
    }

    if (!isRecord(event) || !event.phrase) {
      ignored += 1;
      continue;
    }

    if (!event.phrase_key) {
      event.phrase_key = phraseKey(String(event.phrase));
    }

    if (!("timestamp" in event)) {
      event.timestamp = null;
    }

    events.push(event);
  }

  return { events, ignored };
}

export function recordAssociation(input: MemoryRecordInput): Record<string, unknown> {
  const source = input.source ?? "user_selected";
  if (!(source in POSITIVE_WEIGHTS)) {
    throw new Error(`Unknown memory source: ${source}`);
  }

  const event = withoutNullish({
    event: "resolved",
    phrase: input.phrase,
    phrase_key: phraseKey(input.phrase),
    vendor: input.vendor,
    product_id: input.product_id,
    product_name: input.product_name,
    search_term: input.search_term,
    source,
    size: input.size,
    price: input.price,
    timestamp: input.timestamp ?? now()
  });

  return appendEvent(event, input.base_dir);
}

export function recordRejection(input: MemoryRejectInput): Record<string, unknown> {
  if (!input.wrong_product_id && !input.wrong_product_name) {
    throw new Error("wrong_product_id or wrong_product_name is required");
  }

  const event = withoutNullish({
    event: "rejected",
    phrase: input.phrase,
    phrase_key: phraseKey(input.phrase),
    vendor: input.vendor,
    wrong_product_id: input.wrong_product_id,
    wrong_product_name: input.wrong_product_name,
    correct_product_id: input.correct_product_id,
    correct_product_name: input.correct_product_name,
    source: input.source ?? "correction",
    timestamp: input.timestamp ?? now()
  });

  return appendEvent(event, input.base_dir);
}

export function buildSummary(options: {
  vendor?: string | null;
  limit?: number;
  base_dir?: string | null;
} = {}): Record<string, unknown> {
  const { events, ignored } = loadEvents(options.base_dir);
  const limit = options.limit ?? 3;
  let ignoredEvents = ignored;
  const groups = new Map<string, Group>();
  const recentCorrections: Record<string, unknown>[] = [];

  for (const event of events) {
    const eventVendor = stringOrNull(event.vendor);
    if (options.vendor && eventVendor !== options.vendor) {
      continue;
    }

    const pkey = String(event.phrase_key);
    const groupKey = `${pkey}\u0000${eventVendor ?? ""}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        phrase: event.phrase,
        phrase_key: pkey,
        vendor: eventVendor,
        candidates: new Map()
      };
      groups.set(groupKey, group);
    }
    group.phrase = event.phrase || group.phrase;

    if (event.event === "resolved") {
      try {
        const candidate = candidateFor(group, stringOrNull(event.product_id), stringOrNull(event.product_name));
        candidate.score += POSITIVE_WEIGHTS[(event.source as MemorySource) ?? "manual"] ?? 1.0;
        candidate.evidence_count += 1;
        updateCandidate(candidate, event);
      } catch {
        ignoredEvents += 1;
      }
    }

    if (event.event === "rejected") {
      try {
        const wrongKey = productKey(stringOrNull(event.wrong_product_id), stringOrNull(event.wrong_product_name));
        const wrong = group.candidates.get(wrongKey) ?? newCandidate(
          stringOrNull(event.wrong_product_id),
          stringOrNull(event.wrong_product_name)
        );
        group.candidates.set(wrongKey, wrong);
        wrong.score += REJECTION_WEIGHT;
        wrong.reject_count += 1;
        wrong.last_seen = stringOrNull(event.timestamp) ?? wrong.last_seen;
      } catch {
        ignoredEvents += 1;
        continue;
      }

      if (event.correct_product_id || event.correct_product_name) {
        const correct = candidateFor(group, stringOrNull(event.correct_product_id), stringOrNull(event.correct_product_name));
        correct.score += POSITIVE_WEIGHTS.correction;
        correct.evidence_count += 1;
        updateCandidate(correct, event, true);
      }

      recentCorrections.push(withoutNullish({
        phrase: event.phrase,
        phrase_key: pkey,
        vendor: eventVendor,
        avoid: event.wrong_product_name || event.wrong_product_id,
        prefer: event.correct_product_name || event.correct_product_id,
        timestamp: event.timestamp
      }));
    }
  }

  const associations: Record<string, unknown>[] = [];
  for (const group of groups.values()) {
    const candidates = [...group.candidates.values()]
      .filter((candidate) => candidate.score > 0)
      .map(formatCandidate)
      .sort((left, right) => {
        const scoreDelta = Number(right.score) - Number(left.score);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return String(right.last_seen ?? "").localeCompare(String(left.last_seen ?? ""));
      });

    if (candidates.length > 0) {
      associations.push({
        phrase: group.phrase,
        phrase_key: group.phrase_key,
        vendor: group.vendor,
        candidates: candidates.slice(0, limit)
      });
    }
  }

  associations.sort((left, right) => {
    const phraseDelta = String(left.phrase_key).localeCompare(String(right.phrase_key));
    if (phraseDelta !== 0) {
      return phraseDelta;
    }

    return String(left.vendor ?? "").localeCompare(String(right.vendor ?? ""));
  });

  recentCorrections.sort((left, right) =>
    String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? ""))
  );

  return {
    version: 1,
    generated_at: now(),
    associations,
    recent_corrections: recentCorrections.slice(0, 10),
    ignored_events: ignoredEvents
  };
}

export function explain(
  phrase: string,
  options: { vendor?: string | null; limit?: number; base_dir?: string | null } = {}
): Record<string, unknown> {
  const targetKey = phraseKey(phrase);
  const summary = buildSummary({
    vendor: options.vendor,
    limit: options.limit ?? 5,
    base_dir: options.base_dir
  });
  const associations = Array.isArray(summary.associations) ? summary.associations : [];
  const recentCorrections = Array.isArray(summary.recent_corrections) ? summary.recent_corrections : [];

  return {
    phrase,
    phrase_key: targetKey,
    matches: associations.filter((entry) => isRecord(entry) && entry.phrase_key === targetKey),
    recent_corrections: recentCorrections.filter((entry) => isRecord(entry) && entry.phrase_key === targetKey)
  };
}

export function writeSummary(baseDir?: string | null): Record<string, unknown> {
  const summary = buildSummary({ base_dir: baseDir });
  const path = summaryPath(baseDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifySorted(summary, 2), "utf8");
  return summary;
}

function appendEvent(event: Record<string, unknown>, baseDir?: string | null): Record<string, unknown> {
  const path = eventsPath(baseDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${stringifySorted(event)}\n`, "utf8");
  writeSummary(baseDir);
  return event;
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function candidateFor(group: Group, productId: string | null, productName: string | null): Candidate {
  const key = productKey(productId, productName);
  const existing = group.candidates.get(key);
  if (existing) {
    if (productId) {
      existing.product_id = productId;
    }
    if (productName) {
      existing.product_name = productName;
    }
    return existing;
  }

  const candidate = newCandidate(productId, productName);
  group.candidates.set(key, candidate);
  return candidate;
}

function newCandidate(productId: string | null, productName: string | null): Candidate {
  return {
    product_id: productId,
    product_name: productName,
    score: 0,
    evidence_count: 0,
    reject_count: 0,
    last_seen: null,
    search_terms: [],
    sizes: [],
    prices: []
  };
}

function updateCandidate(candidate: Candidate, event: Record<string, unknown>, correct = false): void {
  candidate.last_seen = stringOrNull(event.timestamp) ?? candidate.last_seen;
  if (correct) {
    return;
  }

  addUnique(candidate.search_terms, stringOrNull(event.search_term));
  addUnique(candidate.sizes, stringOrNull(event.size));
  addUnique(candidate.prices, stringOrNull(event.price));
}

function formatCandidate(candidate: Candidate): Record<string, unknown> {
  return withoutNullish({
    product_id: candidate.product_id,
    product_name: candidate.product_name,
    score: Math.round(candidate.score * 1000) / 1000,
    evidence_count: candidate.evidence_count,
    reject_count: candidate.reject_count,
    last_seen: candidate.last_seen,
    search_terms: candidate.search_terms.length > 0 ? candidate.search_terms : null,
    sizes: candidate.sizes.length > 0 ? candidate.sizes : null,
    prices: candidate.prices.length > 0 ? candidate.prices : null
  });
}

function addUnique(values: string[], value: string | null): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
