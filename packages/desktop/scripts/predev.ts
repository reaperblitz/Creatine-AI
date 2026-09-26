import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.CREATINE_CHANNEL ?? "dev"}`

await $`cd ../creatine && bun script/build-node.ts`
await downloadCliToResources()
