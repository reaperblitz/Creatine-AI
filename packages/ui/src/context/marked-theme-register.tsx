import { registerCustomTheme } from "@pierre/diffs"
import { CreatineTheme } from "./marked-theme"

let registered = false

export function registerCreatineTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Creatine", () => Promise.resolve(CreatineTheme))
}
