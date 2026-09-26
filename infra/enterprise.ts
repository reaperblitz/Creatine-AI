import { SECRET } from "./secret"
import { shortDomain } from "./stage"

const storage = new sst.cloudflare.Bucket("EnterpriseStorage")

new sst.cloudflare.x.SolidStart("Teams", {
  domain: shortDomain,
  path: "packages/enterprise",
  buildCommand: "bun run build:cloudflare",
  link: [SECRET.SupportApiKey],
  environment: {
    CREATINE_STORAGE_ADAPTER: "r2",
    CREATINE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
    CREATINE_STORAGE_ACCESS_KEY_ID: SECRET.R2AccessKey.value,
    CREATINE_STORAGE_SECRET_ACCESS_KEY: SECRET.R2SecretKey.value,
    CREATINE_STORAGE_BUCKET: storage.name,
  },
})
