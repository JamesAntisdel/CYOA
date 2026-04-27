import type { AnalyticsEventName, ProviderName } from "@cyoa/shared";

import { assertAdmin, type AccountLike } from "./lib/authz";
import { AppError } from "./lib/errors";

export type AnalyticsEventRecord = {
  accountId?: string;
  saveId?: string;
  taleId?: string;
  roomId?: string;
  eventName: AnalyticsMetricName;
  storyId?: string;
  turnNumber?: number;
  provider?: ProviderName;
  payload: Record<string, unknown>;
  redacted: boolean;
  createdAt: number;
};

export type AnalyticsMetricName =
  | AnalyticsEventName
  | "activation.completed"
  | "tutorial.completed"
  | "signup.prompt_shown"
  | "signup.completed"
  | "billing.subscription_started"
  | "billing.pro_upgraded"
  | "cost.recorded"
  | "live_read.started"
  | "live_read.heartbeat"
  | "live_read.ended"
  | "provider.fallback"
  | "latency.recorded"
  | "error.recorded";

export type AnalyticsEventInput = Omit<AnalyticsEventRecord, "payload" | "redacted"> & {
  payload?: Record<string, unknown>;
  redacted?: boolean;
};

export type DashboardWindow = {
  from: number;
  to: number;
};

export type FunnelMetric = {
  eventName: AnalyticsMetricName;
  label: string;
  count: number;
  conversionRate: number;
};

export type CostMetric = {
  provider: string;
  storyId: string;
  sessions: number;
  turns: number;
  textTokens: number;
  imageGenerations: number;
  videoGenerations: number;
  storageMb: number;
  estimatedCostCents: number;
  costPerTurnCents: number;
};

export type SafetyMetric = {
  eventName: "safety.blocked" | "safety.redirected" | "safety.ended";
  count: number;
  rate: number;
  categories: Record<string, number>;
  actions: Record<string, number>;
};

export type LiveDashboardMetric = {
  activeReads: number;
  activeCoopRooms: number;
  fallbackRate: number;
  errorRate: number;
  latency: {
    firstTokenP50Ms: number;
    firstTokenP95Ms: number;
    totalP50Ms: number;
    totalP95Ms: number;
  };
};

export type OperatorDashboard = {
  generatedAt: number;
  window: DashboardWindow;
  funnel: FunnelMetric[];
  cost: CostMetric[];
  safety: SafetyMetric[];
  live: LiveDashboardMetric;
};

const FUNNEL_STEPS: Array<{ eventName: AnalyticsMetricName; label: string }> = [
  { eventName: "age_gate.shown", label: "Landing" },
  { eventName: "guest.created", label: "Age gate passed" },
  { eventName: "save.created", label: "First scene" },
  { eventName: "activation.completed", label: "Activated" },
  { eventName: "tutorial.completed", label: "Tutorial completed" },
  { eventName: "signup.completed", label: "Signup" },
  { eventName: "paywall.shown", label: "Paywall" },
  { eventName: "billing.subscription_started", label: "Subscribed" },
  { eventName: "billing.pro_upgraded", label: "Pro upgraded" },
  { eventName: "tale.published", label: "Published" },
  { eventName: "coop.room_created", label: "Co-op" },
];

const SAFETY_EVENTS = ["safety.blocked", "safety.redirected", "safety.ended"] as const;

const SENSITIVE_KEY_PATTERNS = [
  /email/i,
  /oauth/i,
  /profile/i,
  /payment/i,
  /card/i,
  /authorization/i,
  /cookie/i,
  /guest.*hash/i,
  /guest.*token/i,
  /birth/i,
  /dob/i,
  /unsafe.*text/i,
  /mature.*text/i,
  /raw.*text/i,
  /raw.*output/i,
  /invite.*url/i,
  /invite.*token/i,
];

const TEXT_VALUE_KEY_PATTERNS = [
  /prose/i,
  /prompt/i,
  /completion/i,
  /^text$/i,
  /unsafe/i,
  /mature/i,
];

export function buildAnalyticsEvent(input: AnalyticsEventInput): AnalyticsEventRecord {
  assertEventName(input.eventName);
  if (input.createdAt < 0) throw new AppError("analytics_created_at_invalid");
  if (input.turnNumber !== undefined && input.turnNumber < 0) {
    throw new AppError("analytics_turn_number_invalid");
  }

  const sanitized = sanitizePayload(input.payload ?? {});
  return {
    ...optionalIdFields(input),
    eventName: input.eventName,
    ...(input.storyId === undefined ? {} : { storyId: input.storyId }),
    ...(input.turnNumber === undefined ? {} : { turnNumber: input.turnNumber }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    payload: sanitized.payload,
    redacted: input.redacted === true || sanitized.redacted,
    createdAt: input.createdAt,
  };
}

export function requireAdminDashboard(account: AccountLike | null | undefined): void {
  assertAdmin(account);
}

export function buildOperatorDashboard(input: {
  account: AccountLike | null | undefined;
  events: AnalyticsEventRecord[];
  now: number;
  windowMs?: number;
}): OperatorDashboard {
  requireAdminDashboard(input.account);
  const window = {
    from: input.now - (input.windowMs ?? 24 * 60 * 60 * 1000),
    to: input.now,
  };
  const events = input.events.filter(
    (event) => event.createdAt >= window.from && event.createdAt <= window.to,
  );

  return {
    generatedAt: input.now,
    window,
    funnel: buildFunnelMetrics(events),
    cost: buildCostMetrics(events),
    safety: buildSafetyMetrics(events),
    live: buildLiveMetrics(events, input.now),
  };
}

export function buildFunnelMetrics(events: AnalyticsEventRecord[]): FunnelMetric[] {
  const counts = countBy(events, (event) => event.eventName);
  let previous = 0;

  return FUNNEL_STEPS.map((step, index) => {
    const count = counts[step.eventName] ?? 0;
    const conversionRate = index === 0 ? 1 : ratio(count, previous);
    previous = count;
    return { ...step, count, conversionRate };
  });
}

export function buildCostMetrics(events: AnalyticsEventRecord[]): CostMetric[] {
  const rows = new Map<string, CostMetric>();
  for (const event of events) {
    if (!isCostEvent(event)) continue;
    const provider = event.provider ?? asString(event.payload.provider) ?? "unknown";
    const storyId = event.storyId ?? asString(event.payload.storyId) ?? "unknown";
    const key = `${provider}:${storyId}`;
    const row = rows.get(key) ?? {
      provider,
      storyId,
      sessions: 0,
      turns: 0,
      textTokens: 0,
      imageGenerations: 0,
      videoGenerations: 0,
      storageMb: 0,
      estimatedCostCents: 0,
      costPerTurnCents: 0,
    };

    row.sessions += event.saveId ? 1 : readNumber(event.payload, "sessions");
    row.turns += readNumber(event.payload, "turns") || (event.turnNumber !== undefined ? 1 : 0);
    row.textTokens += readNumber(event.payload, "inputTokens") + readNumber(event.payload, "outputTokens");
    row.imageGenerations += readNumber(event.payload, "imageGenerations");
    row.videoGenerations += readNumber(event.payload, "videoGenerations");
    row.storageMb += readNumber(event.payload, "storageMb");
    row.estimatedCostCents += readNumber(event.payload, "estimatedCostCents");
    row.costPerTurnCents = row.turns > 0 ? row.estimatedCostCents / row.turns : 0;
    rows.set(key, row);
  }

  return Array.from(rows.values()).sort((left, right) => right.estimatedCostCents - left.estimatedCostCents);
}

export function buildSafetyMetrics(events: AnalyticsEventRecord[]): SafetyMetric[] {
  const total = events.length;
  return SAFETY_EVENTS.map((eventName) => {
    const matching = events.filter((event) => event.eventName === eventName);
    return {
      eventName,
      count: matching.length,
      rate: ratio(matching.length, total),
      categories: countBy(matching, (event) => asString(event.payload.category) ?? "unknown"),
      actions: countBy(matching, (event) => asString(event.payload.action) ?? eventName.split(".")[1] ?? "unknown"),
    };
  });
}

export function buildLiveMetrics(events: AnalyticsEventRecord[], now: number): LiveDashboardMetric {
  const liveCutoff = now - 5 * 60 * 1000;
  const recent = events.filter((event) => event.createdAt >= liveCutoff);
  const activeReads = new Set(
    recent
      .filter((event) => event.eventName === "live_read.started" || event.eventName === "live_read.heartbeat")
      .map((event) => event.saveId)
      .filter(Boolean),
  ).size;
  const activeCoopRooms = new Set(
    recent
      .filter((event) => event.eventName === "coop.room_created" || event.eventName === "coop.joined")
      .map((event) => event.roomId)
      .filter(Boolean),
  ).size;
  const fallbackCount = events.filter(
    (event) => event.eventName === "provider.fallback" || event.payload.fallback === true,
  ).length;
  const errorCount = events.filter(
    (event) => event.eventName === "turn.failed" || event.eventName === "error.recorded",
  ).length;
  const firstTokenLatencies = events
    .map((event) => readNumber(event.payload, "firstTokenMs"))
    .filter((value) => value > 0);
  const totalLatencies = events
    .map((event) => readNumber(event.payload, "totalMs") || readNumber(event.payload, "llmMs"))
    .filter((value) => value > 0);

  return {
    activeReads,
    activeCoopRooms,
    fallbackRate: ratio(fallbackCount, events.length),
    errorRate: ratio(errorCount, events.length),
    latency: {
      firstTokenP50Ms: percentile(firstTokenLatencies, 50),
      firstTokenP95Ms: percentile(firstTokenLatencies, 95),
      totalP50Ms: percentile(totalLatencies, 50),
      totalP95Ms: percentile(totalLatencies, 95),
    },
  };
}

export function sanitizePayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>;
  redacted: boolean;
} {
  const sanitized = sanitizeValue(payload, []);
  return {
    payload: typeof sanitized.value === "object" && sanitized.value !== null && !Array.isArray(sanitized.value)
      ? sanitized.value as Record<string, unknown>
      : {},
    redacted: sanitized.redacted,
  };
}

function sanitizeValue(value: unknown, path: string[]): { value: unknown; redacted: boolean } {
  const key = path[path.length - 1] ?? "";
  if (isSensitiveKey(key)) return { value: "[redacted]", redacted: true };
  if (typeof value === "string" && TEXT_VALUE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return { value: "[redacted]", redacted: true };
  }
  if (Array.isArray(value)) {
    let redacted = false;
    const result = value.map((item, index) => {
      const sanitized = sanitizeValue(item, [...path, String(index)]);
      redacted ||= sanitized.redacted;
      return sanitized.value;
    });
    return { value: result, redacted };
  }
  if (typeof value === "object" && value !== null) {
    let redacted = false;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeValue(childValue, [...path, childKey]);
      redacted ||= sanitized.redacted;
      result[childKey] = sanitized.value;
    }
    return { value: result, redacted };
  }

  return { value, redacted: false };
}

function optionalIdFields(input: AnalyticsEventInput) {
  return {
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.saveId === undefined ? {} : { saveId: input.saveId }),
    ...(input.taleId === undefined ? {} : { taleId: input.taleId }),
    ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
  };
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function assertEventName(eventName: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(eventName)) {
    throw new AppError("analytics_event_name_invalid");
  }
}

function isCostEvent(event: AnalyticsEventRecord): boolean {
  return (
    event.eventName === "cost.recorded" ||
    event.eventName === "llm.completed" ||
    event.payload.estimatedCostCents !== undefined ||
    event.payload.imageGenerations !== undefined ||
    event.payload.videoGenerations !== undefined ||
    event.payload.storageMb !== undefined
  );
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}
