import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export type EnvironmentName = "dev" | "staging" | "prod";

export const environment = config.get("environment") ?? pulumi.getStack();
export const labels = {
  app: "cyoa",
  environment,
  managed_by: "pulumi",
};

export const project = {
  projectId: config.require("gcpProjectId"),
  name: config.get("gcpProjectName") ?? `cyoa-${environment}`,
  orgId: config.get("gcpOrgId"),
  billingAccount: config.get("gcpBillingAccount"),
  region: config.get("gcpRegion") ?? "us-central1",
};

export const domains = {
  root: config.get("rootDomain"),
  web: config.get("webDomain"),
  dnsZoneName: config.get("dnsZoneName") ?? `cyoa-${environment}`,
  dnsZoneDnsName: config.get("dnsZoneDnsName"),
};

export const monitoring = {
  notificationChannelIds: config.getObject<string[]>("monitoringNotificationChannelIds") ?? [],
};

export const convex = {
  deployment: config.get("convexDeployment"),
};
