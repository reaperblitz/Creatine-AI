declare global {
  const CREATINE_VERSION: string
  const CREATINE_CHANNEL: string
}

export const InstallationVersion = typeof CREATINE_VERSION === "string" ? CREATINE_VERSION : "local"
export const InstallationChannel = typeof CREATINE_CHANNEL === "string" ? CREATINE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
