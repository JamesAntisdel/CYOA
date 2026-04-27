import * as gcp from "@pulumi/gcp";
import { projectId, services } from "./project.js";

export const convexVertexServiceAccount = new gcp.serviceaccount.Account(
  "convex-vertex-ai",
  {
    project: projectId,
    accountId: "convex-vertex-ai",
    displayName: "Convex to Vertex AI runtime",
    description: "Used by Convex actions to call Vertex AI providers.",
  },
  { dependsOn: services },
);

export const ciDeployServiceAccount = new gcp.serviceaccount.Account(
  "ci-deploy",
  {
    project: projectId,
    accountId: "ci-deploy",
    displayName: "GitHub Actions deploy pipeline",
    description: "Used by CI to deploy Pulumi, Convex, web assets, and EAS updates.",
  },
  { dependsOn: services },
);

const convexVertexRoles = ["roles/aiplatform.user"];
const ciDeployRoles = [
  "roles/compute.admin",
  "roles/dns.admin",
  "roles/iam.serviceAccountAdmin",
  "roles/iam.serviceAccountUser",
  "roles/monitoring.editor",
  "roles/secretmanager.admin",
  "roles/serviceusage.serviceUsageAdmin",
  "roles/storage.admin",
];

export const convexVertexBindings = convexVertexRoles.map(
  (role) =>
    new gcp.projects.IAMMember(`convex-vertex-${role.split("/").at(-1)}`, {
      project: projectId,
      role,
      member: convexVertexServiceAccount.email.apply((email) => `serviceAccount:${email}`),
    }),
);

export const ciDeployBindings = ciDeployRoles.map(
  (role) =>
    new gcp.projects.IAMMember(`ci-deploy-${role.split("/").at(-1)}`, {
      project: projectId,
      role,
      member: ciDeployServiceAccount.email.apply((email) => `serviceAccount:${email}`),
    }),
);

