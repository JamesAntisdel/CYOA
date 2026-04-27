import * as gcp from "@pulumi/gcp";
import { domains } from "./config.js";
import { webIpAddress } from "./hosting.js";
import { projectId, services } from "./project.js";

export const managedZone = domains.dnsZoneDnsName
  ? new gcp.dns.ManagedZone(
      "cyoa-zone",
      {
        project: projectId,
        name: domains.dnsZoneName,
        dnsName: domains.dnsZoneDnsName.endsWith(".")
          ? domains.dnsZoneDnsName
          : `${domains.dnsZoneDnsName}.`,
        description: "CYOA application DNS zone.",
      },
      { dependsOn: services },
    )
  : undefined;

export const webARecord =
  managedZone && domains.web
    ? new gcp.dns.RecordSet("cyoa-web-a", {
        project: projectId,
        managedZone: managedZone.name,
        name: domains.web.endsWith(".") ? domains.web : `${domains.web}.`,
        type: "A",
        ttl: 300,
        rrdatas: [webIpAddress.address],
      })
    : undefined;

