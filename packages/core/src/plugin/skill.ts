/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeCreatineContent from "./skill/customize-creatine.md" with { type: "text" }

export const CustomizeCreatineContent = customizeCreatineContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-creatine",
            description:
              "Use ONLY when the user is editing or creating creatine's own configuration: opencode.json, opencode.jsonc, files under .creatine/, or files under ~/.config/creatine/. Also use when creating or fixing creatine agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring creatine itself.",
            location: AbsolutePath.make("/builtin/customize-creatine.md"),
            content: CustomizeCreatineContent,
          }),
        }),
      )
    })
  }),
})
