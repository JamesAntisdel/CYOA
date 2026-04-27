# CYOA Infrastructure

Pulumi TypeScript provisions the GCP resources around the managed Convex backend:

- GCP project API enablement for Vertex AI, Storage, Cloud CDN, Cloud DNS, Secret Manager, IAM, and Monitoring.
- Service accounts for Convex to Vertex AI calls and GitHub Actions deployment.
- Static web and generated asset buckets, with a Cloud CDN skeleton for the web bucket.
- DNS records for the web endpoint.
- Secret Manager entries for production secrets without committing secret values.
- Cloud Monitoring uptime and Vertex AI error alert skeletons.

## Bootstrap

1. Create or choose a GCP project and billing account.
2. Authenticate locally with `gcloud auth application-default login`.
3. Select a stack from `dev`, `staging`, or `prod`.
4. Replace placeholder config in `Pulumi.<stack>.yaml` with real project IDs and domains.
5. Run `pnpm --filter @cyoa/infra preview`.

If Pulumi should create the GCP project, set `cyoa:gcpOrgId` and `cyoa:gcpBillingAccount`. Otherwise `cyoa:gcpProjectId` is treated as an existing project.

## Secrets

Secret Manager resources are defined, but values must be added outside source control:

- `anthropic-api-key`
- `betterauth-secret`
- `convex-deploy-key`
- `eas-token`
- `stripe-secret-key`
- `stripe-webhook-secret`
- `vertex-service-account-json`

GitHub Actions should receive only approved CI secrets, such as `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `PULUMI_ACCESS_TOKEN`, `CONVEX_DEPLOY_KEY`, and `EXPO_TOKEN`. Runtime provider secrets should stay in Secret Manager and be mirrored into Convex during deployment.

## Manual Follow-up

- Request Vertex AI quota for the target regions and models.
- Configure OAuth clients for Google, Apple, GitHub, Microsoft, and Discord.
- Replace placeholder domains with owned domains and delegate the managed Cloud DNS zone.
- Add Monitoring notification channels and place their IDs in stack config.
- Wire workload identity federation for GitHub Actions before enabling production deploys.
