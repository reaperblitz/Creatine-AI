import { expect, test } from "bun:test"
import path from "path"
import { testRender } from "@opentui/solid"
import { abbreviateHome } from "../src/runtime"
import { TuiPathsProvider, useTuiPaths } from "../src/context/runtime"

test("abbreviates paths within home boundaries", () => {
  // Fixtures are built from path.sep because abbreviateHome joins with the platform
  // separator; hard-coded POSIX fixtures only ever passed on Linux and macOS.
  const home = path.join(path.sep, "home", "test")
  expect(abbreviateHome(home, home)).toBe("~")
  expect(abbreviateHome(path.join(home, "project"), home)).toBe(`~${path.sep}project`)
  // A sibling that merely shares a name prefix is not inside home.
  expect(abbreviateHome(path.join(path.sep, "home", "tester", "project"), home)).toBe(
    path.join(path.sep, "home", "tester", "project"),
  )
  expect(abbreviateHome(path.join(path.sep, "tmp", "project"), home)).toBe(
    path.join(path.sep, "tmp", "project"),
  )
})

test("provides focused immutable runtime inputs", async () => {
  let paths: ReturnType<typeof useTuiPaths>

  function Runtime() {
    paths = useTuiPaths()
    return <text>{paths.cwd}</text>
  }

  const app = await testRender(
    () => (
      <TuiPathsProvider value={{ cwd: "/work", home: "/home/test", state: "/state", worktree: "/worktree" }}>
        <Runtime />
      </TuiPathsProvider>
    ),
    { width: 40, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("/work")
    expect(Object.isFrozen(paths!)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
