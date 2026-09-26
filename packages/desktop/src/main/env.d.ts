interface ImportMetaEnv {
  readonly CREATINE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:creatine-server" {
  export namespace Server {
    export const listen: typeof import("../../../creatine/dist/types/src/node").Server.listen
    export type Listener = import("../../../creatine/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../creatine/dist/types/src/node").Config.get
    export type Info = import("../../../creatine/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../creatine/dist/types/src/node").bootstrap
}
