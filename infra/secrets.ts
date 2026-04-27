import * as gcp from "@pulumi/gcp";
import { labels } from "./config.js";
import { projectId, services } from "./project.js";

const secretNames = [
  "anthropic-api-key",
  "betterauth-secret",
  "convex-deploy-key",
  "eas-token",
  "github-actions-workload-identity-provider",
  "stripe-secret-key",
  "stripe-webhook-secret",
  "vertex-service-account-json",
];

export const secrets = Object.fromEntries(
  secretNames.map((secretId) => [
    secretId,
    new gcp.secretmanager.Secret(
      secretId,
      {
        project: projectId,
        secretId,
        labels,
        replication: {
          auto: {},
        },
      },
      { dependsOn: services },
    ),
  ]),
);

