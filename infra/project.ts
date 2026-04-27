import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { labels, project } from "./config.js";

const requiredApis = [
  "aiplatform.googleapis.com",
  "cloudbilling.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "compute.googleapis.com",
  "dns.googleapis.com",
  "iam.googleapis.com",
  "monitoring.googleapis.com",
  "secretmanager.googleapis.com",
  "serviceusage.googleapis.com",
  "storage.googleapis.com",
];

const managedProject =
  project.orgId && project.billingAccount
    ? new gcp.organizations.Project("cyoa-project", {
        projectId: project.projectId,
        name: project.name,
        orgId: project.orgId,
        billingAccount: project.billingAccount,
        labels,
      })
    : undefined;

export const projectId: pulumi.Input<string> = managedProject?.projectId ?? project.projectId;

export const services = requiredApis.map(
  (service) =>
    new gcp.projects.Service(
      service.replace(".googleapis.com", "").replaceAll(".", "-"),
      {
        project: projectId,
        service,
        disableDependentServices: false,
        disableOnDestroy: false,
      },
      { dependsOn: managedProject ? [managedProject] : [] },
    ),
);

