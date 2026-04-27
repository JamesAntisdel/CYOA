import * as gcp from "@pulumi/gcp";
import { domains, labels, project } from "./config.js";
import { projectId, services } from "./project.js";

const bucketLocation = project.region.toUpperCase().startsWith("US") ? "US" : project.region;

export const webBucket = new gcp.storage.Bucket(
  "cyoa-web",
  {
    project: projectId,
    name: `cyoa-web-${domains.web ?? project.projectId}`,
    location: bucketLocation,
    labels,
    uniformBucketLevelAccess: true,
    website: {
      mainPageSuffix: "index.html",
      notFoundPage: "index.html",
    },
  },
  { dependsOn: services },
);

export const assetsBucket = new gcp.storage.Bucket(
  "cyoa-assets",
  {
    project: projectId,
    name: `cyoa-assets-${project.projectId}`,
    location: bucketLocation,
    labels,
    uniformBucketLevelAccess: true,
    cors: [
      {
        origins: domains.web ? [`https://${domains.web}`] : ["*"],
        methods: ["GET", "HEAD", "OPTIONS"],
        responseHeaders: ["Content-Type", "Cache-Control"],
        maxAgeSeconds: 3600,
      },
    ],
  },
  { dependsOn: services },
);

export const webPublicRead = new gcp.storage.BucketIAMMember("web-public-read", {
  bucket: webBucket.name,
  role: "roles/storage.objectViewer",
  member: "allUsers",
});

export const webBackendBucket = new gcp.compute.BackendBucket("cyoa-web-backend", {
  project: projectId,
  bucketName: webBucket.name,
  enableCdn: true,
  cdnPolicy: {
    cacheMode: "CACHE_ALL_STATIC",
    defaultTtl: 3600,
    maxTtl: 86400,
    clientTtl: 3600,
  },
});

export const webUrlMap = new gcp.compute.URLMap("cyoa-web-url-map", {
  project: projectId,
  defaultService: webBackendBucket.id,
});

export const webCertificate = domains.web
  ? new gcp.compute.ManagedSslCertificate("cyoa-web-cert", {
      project: projectId,
      managed: {
        domains: [domains.web],
      },
    })
  : undefined;

export const webHttpsProxy = webCertificate
  ? new gcp.compute.TargetHttpsProxy("cyoa-web-https-proxy", {
      project: projectId,
      urlMap: webUrlMap.id,
      sslCertificates: [webCertificate.id],
    })
  : undefined;

export const webIpAddress = new gcp.compute.GlobalAddress("cyoa-web-ip", {
  project: projectId,
});

export const webForwardingRule = webHttpsProxy
  ? new gcp.compute.GlobalForwardingRule("cyoa-web-https", {
      project: projectId,
      ipAddress: webIpAddress.address,
      ipProtocol: "TCP",
      portRange: "443",
      target: webHttpsProxy.id,
    })
  : undefined;

