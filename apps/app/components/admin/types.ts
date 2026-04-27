export type AdminAccount = {
  accountId?: string;
  isAdmin?: boolean;
};

export type AdminFunnelMetric = {
  eventName: string;
  label: string;
  count: number;
  conversionRate: number;
};

export type AdminCostMetric = {
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

export type AdminSafetyMetric = {
  eventName: "safety.blocked" | "safety.redirected" | "safety.ended";
  count: number;
  rate: number;
  categories: Record<string, number>;
  actions: Record<string, number>;
};

export type AdminLiveMetric = {
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

export type AdminDashboardData = {
  generatedAt: number;
  window: {
    from: number;
    to: number;
  };
  funnel: AdminFunnelMetric[];
  cost: AdminCostMetric[];
  safety: AdminSafetyMetric[];
  live: AdminLiveMetric;
};
