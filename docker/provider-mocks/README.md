# Provider Mocks

The mock server used by `docker-compose.yml` lives in `scripts/dev/provider-mocks.mjs` so it can run both inside Docker and directly with local Node.

It intentionally returns deterministic, non-billable responses for Anthropic-like, DeepSeek-like, Vertex-like, and health-check endpoints. Use `MOCK_PROVIDER_MODE=fail` or `MOCK_PROVIDER_STATUS=503` to exercise local failure handling without making live provider calls.
