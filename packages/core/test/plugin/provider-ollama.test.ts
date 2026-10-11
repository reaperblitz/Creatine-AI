import { describe, expect, test } from "bun:test"
import { displayName, isRunning, parseTags, pull, recommend, RECOMMENDED, OLLAMA_HOST } from "../../src/plugin/provider/ollama"
import { Effect } from "effect"

describe("the offered model list", () => {
  test("offers two lightweight and two deeper models, as asked", () => {
    expect(RECOMMENDED).toHaveLength(4)
    const light = RECOMMENDED.filter((m) => m.minRamGb <= 4)
    const deep = RECOMMENDED.filter((m) => m.minRamGb >= 8)
    expect(light).toHaveLength(2)
    expect(deep).toHaveLength(2)
  })

  test("covers both qwen and llama, so it is not one vendor's list", () => {
    expect(RECOMMENDED.some((m) => m.id.startsWith("qwen"))).toBe(true)
    expect(RECOMMENDED.some((m) => m.id.startsWith("llama"))).toBe(true)
  })

  test("every model states the RAM and disk it needs, in the name the user sees", () => {
    for (const model of RECOMMENDED) {
      const shown = displayName(model)
      expect(shown).toContain(`${model.minRamGb} GB RAM`)
      expect(shown).toContain(`${model.diskGb} GB disk`)
    }
  })
})

describe("model sizing by hardware", () => {
  test("a small machine gets a lightweight model, not the largest that technically fits", () => {
    expect(recommend({ totalRamGb: 4, cpuCores: 2 }).id).toBe("llama3.2:3b")
    expect(recommend({ totalRamGb: 2, cpuCores: 1 }).id).toBe("qwen2.5-coder:1.5b")
  })

  test("an 8 GB machine - the common case - gets the 7B coder model", () => {
    expect(recommend({ totalRamGb: 8, cpuCores: 4 }).id).toBe("qwen2.5-coder:7b")
    expect(recommend({ totalRamGb: 16, cpuCores: 8 }).id).toBe("qwen2.5-coder:7b")
  })

  test("bigger RAM climbs to the deeper model", () => {
    expect(recommend({ totalRamGb: 24, cpuCores: 8 }).id).toBe("qwen2.5-coder:14b")
    expect(recommend({ totalRamGb: 64, cpuCores: 16 }).id).toBe("qwen2.5-coder:14b")
  })

  test("a machine below every threshold still gets something rather than nothing", () => {
    expect(recommend({ totalRamGb: 1, cpuCores: 1 }).id).toBe(RECOMMENDED[0].id)
  })

  test("the ladder never goes downhill", () => {
    // Both lightweight entries legitimately sit at 4 GB, so the invariant is non-decreasing,
    // not strictly increasing: a heavier model must never be listed below a lighter one.
    for (let i = 1; i < RECOMMENDED.length; i++)
      expect(RECOMMENDED[i].minRamGb).toBeGreaterThanOrEqual(RECOMMENDED[i - 1].minRamGb)
    expect(RECOMMENDED[RECOMMENDED.length - 1].minRamGb).toBeGreaterThan(RECOMMENDED[0].minRamGb)
  })

  test("cpu cores do not drive the choice", () => {
    // RAM is the binding constraint for a resident model; a many-core box with little RAM
    // must not be recommended a model it cannot hold.
    expect(recommend({ totalRamGb: 4, cpuCores: 64 }).id).toBe("llama3.2:3b")
  })
})

describe("detecting a running daemon", () => {
  test("an answering daemon is reported as running", async () => {
    expect(await isRunning(async () => new Response("{}", { status: 200 }))).toBe(true)
  })

  test("a refused connection is not running, and does not throw", async () => {
    expect(
      await isRunning(async () => {
        throw new Error("ECONNREFUSED")
      }),
    ).toBe(false)
  })

  test("a non-2xx response is not running", async () => {
    expect(await isRunning(async () => new Response("", { status: 500 }))).toBe(false)
  })
})

describe("parsing the tag list", () => {
  test("reads model names out of a real response", () => {
    expect(parseTags({ models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3.1:8b" }] })).toEqual([
      "qwen2.5-coder:7b",
      "llama3.1:8b",
    ])
  })

  test("survives the shapes a cold or odd daemon returns", () => {
    expect(parseTags({})).toEqual([])
    expect(parseTags({ models: [] })).toEqual([])
    expect(parseTags(null)).toEqual([])
    expect(parseTags("nope")).toEqual([])
    expect(parseTags({ models: [{ nope: 1 }, null, { name: "ok:1b" }] })).toEqual(["ok:1b"])
  })
})

describe("pulling a model", () => {
  const stream = (lines: string[]) =>
    new Response(new Blob([lines.join("\n") + "\n"]), {
      headers: { "content-type": "application/x-ndjson" },
    })

  test("reports progress and succeeds", async () => {
    const seen: number[] = []
    const ok = await Effect.runPromise(
      pull(
        "qwen2.5-coder:7b",
        (percent) => void seen.push(percent),
        async () => stream(['{"completed":50,"total":100,"status":"pulling"}', '{"status":"success"}']),
      ),
    )
    expect(ok).toBe(true)
    expect(seen).toContain(50)
    expect(seen[seen.length - 1]).toBe(100)
  })

  test("a failed pull returns false instead of throwing", async () => {
    const ok = await Effect.runPromise(
      pull(
        "bad:1b",
        () => {},
        async () => {
          throw new Error("boom")
        },
      ),
    )
    expect(ok).toBe(false)
  })

  test("a non-2xx pull reports failure rather than pretending to start", async () => {
    const ok = await Effect.runPromise(pull("bad:1b", () => {}, async () => new Response("", { status: 500 })))
    expect(ok).toBe(false)
  })

  test("malformed stream lines are skipped, not fatal", async () => {
    const ok = await Effect.runPromise(
      pull("m:1b", () => {}, async () => stream(["not json", '{"status":"success"}'])),
    )
    expect(ok).toBe(true)
  })

  test("targets the local daemon by default", async () => {
    let called = ""
    await Effect.runPromise(
      pull(
        "m:1b",
        () => {},
        async (url) => {
          called = url
          return new Response("")
        },
      ),
    )
    expect(called.startsWith(OLLAMA_HOST)).toBe(true)
  })
})