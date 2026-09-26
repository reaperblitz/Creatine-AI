import path from "path"

process.env.CREATINE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
process.env.CREATINE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.CREATINE_DISABLE_MODELS_FETCH = "true"
