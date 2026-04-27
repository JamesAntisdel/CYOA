import * as gcp from "@pulumi/gcp";
import { domains, monitoring } from "./config.js";
import { projectId, services } from "./project.js";

export const webUptimeCheck = domains.web
  ? new gcp.monitoring.UptimeCheckConfig(
      "cyoa-web-uptime",
      {
        project: projectId,
        displayName: "CYOA web uptime",
        timeout: "10s",
        period: "60s",
        httpCheck: {
          path: "/",
          port: 443,
          requestMethod: "GET",
          useSsl: true,
          validateSsl: true,
        },
        monitoredResource: {
          type: "uptime_url",
          labels: {
            host: domains.web,
          },
        },
      },
      { dependsOn: services },
    )
  : undefined;

export const webUptimeAlert =
  webUptimeCheck && monitoring.notificationChannelIds.length > 0
    ? new gcp.monitoring.AlertPolicy("cyoa-web-uptime-alert", {
        project: projectId,
        displayName: "CYOA web uptime failure",
        combiner: "OR",
        notificationChannels: monitoring.notificationChannelIds,
        conditions: [
          {
            displayName: "Web uptime check failed",
            conditionThreshold: {
              filter: webUptimeCheck.uptimeCheckId.apply(
                (id) =>
                  `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.label.check_id="${id}" resource.type="uptime_url"`,
              ),
              comparison: "COMPARISON_LT",
              thresholdValue: 1,
              duration: "180s",
              aggregations: [
                {
                  alignmentPeriod: "60s",
                  perSeriesAligner: "ALIGN_FRACTION_TRUE",
                },
              ],
            },
          },
        ],
      })
    : undefined;

export const vertexErrorAlert =
  monitoring.notificationChannelIds.length > 0
    ? new gcp.monitoring.AlertPolicy("cyoa-vertex-error-alert", {
        project: projectId,
        displayName: "Vertex AI error rate",
        combiner: "OR",
        notificationChannels: monitoring.notificationChannelIds,
        conditions: [
          {
            displayName: "Vertex AI request errors",
            conditionThreshold: {
              filter:
                'resource.type="audited_resource" AND protoPayload.serviceName="aiplatform.googleapis.com" AND protoPayload.status.code>0',
              comparison: "COMPARISON_GT",
              thresholdValue: 0,
              duration: "300s",
              aggregations: [
                {
                  alignmentPeriod: "300s",
                  perSeriesAligner: "ALIGN_COUNT",
                },
              ],
            },
          },
        ],
      })
    : undefined;

