import { describe, expect, test } from "bun:test"
import {
  checkersApply,
  checkersInitial,
  checkersJumps,
  checkersLegal,
  checkersParse,
  checkersWon,
  chessApply,
  chessInitial,
  chessLabel,
  chessLegal,
  chessParse,
  chessTerminal,
  goLabel,
  goParse,
  goPlay,
  isQuit,
  rankOf,
  tttBest,
  tttWinner,
} from "../src/boardgame"

type Cell = "X" | "O" | null

// ─── shared ───

test("recognises every quit word", () => {
  for (const word of ["resign", "quit", "exit", "RESIGN", "resign "]) expect(isQuit(word.trim().toLowerCase())).toBe(true)
  for (const word of ["resigned", "undo", "hint", "e2e4"]) expect(isQuit(word)).toBe(false)
})

// ─── chess ───

describe("chess move parsing", () => {
  test("accepts algebraic squares with and without separators", () => {
    expect(chessParse("e2e4")).toEqual({ from: 52, to: 36, promote: undefined })
    expect(chessParse("e2-e4")).toEqual(chessParse("e2e4"))
    expect(chessParse(" E2 E4 ")).toEqual(chessParse("e2e4"))
  })

  test("captures a promotion piece", () => {
    expect(chessParse("e7e8q")?.promote).toBe("q")
    expect(chessParse("e7e8n")?.promote).toBe("n")
  })

  test("rejects out-of-board and malformed input", () => {
    for (const bad of ["e2e9", "i2i3", "z9z8", "", "e2", "hello", "e2e4k"])
      expect(chessParse(bad)).toBeUndefined()
  })

  test("round-trips a parsed move through the label format", () => {
    expect(chessLabel(chessParse("e2e4")!)).toBe("e2e4")
    expect(chessLabel(chessParse("e7e8q")!)).toBe("e7e8q")
  })
})

describe("chess rules", () => {
  test("white opens with exactly twenty moves", () => {
    expect(chessLegal(chessInitial(), "w").length).toBe(20)
  })

  test("the opening position is not terminal", () => {
    expect(chessTerminal(chessInitial(), "w")).toBeUndefined()
  })

  test("applying e4 places a pawn on e4 and clears e2", () => {
    const parsed = chessParse("e2e4")!
    const start = chessInitial()
    // e2 has two candidate moves, so match on the destination as well as the origin.
    const move = chessLegal(start, "w").find((c) => c.from === parsed.from && c.to === parsed.to)!
    const next = chessApply(start, move)
    expect(next.board[parsed.to]).toBeTruthy()
    expect(next.board[parsed.from]).toBeNull()
    expect(next.turn).toBe("b")
  })

  test("black opens with twenty moves, sixteen of them pawn moves", () => {
    const start = chessInitial()
    const moves = chessLegal(start, "b")
    expect(moves).toHaveLength(20)
    const pawnMoves = moves.filter((move) => start.board[move.from]?.t === "p")
    expect(pawnMoves).toHaveLength(16)
    // Eight single pushes plus eight double pushes from the home rank.
    expect(pawnMoves.filter((move) => move.to - move.from === 8)).toHaveLength(8)
    expect(pawnMoves.filter((move) => move.to - move.from === 16)).toHaveLength(8)
  })

  test("both sides have the same opening move count", () => {
    const start = chessInitial()
    expect(chessLegal(start, "b").length).toBe(chessLegal(start, "w").length)
  })
})

// ─── go ───

describe("go", () => {
  test("parses intersections and rejects the rest", () => {
    expect(goParse("e5")).toEqual({ rank: 4, file: 4 })
    for (const bad of ["j5", "e0", "e10", "", "hello"]) expect(goParse(bad)).toBeUndefined()
  })

  test("round-trips through goLabel", () => {
    expect(goLabel(4, 4)).toBe("e5")
  })

  test("rejects a move onto an occupied point", () => {
    const stones: ("b" | "w" | null)[] = Array.from({ length: 81 }, () => null)
    stones[40] = "w"
    expect(goPlay({ stones, ko: -1, passes: 0 }, 4, 4, "b")).toBeUndefined()
  })

  test("rejects suicide", () => {
    const stones: ("b" | "w" | null)[] = Array.from({ length: 81 }, () => null)
    stones[3 * 9 + 4] = "w"
    stones[5 * 9 + 4] = "w"
    stones[4 * 9 + 3] = "w"
    stones[4 * 9 + 5] = "w"
    expect(goPlay({ stones, ko: -1, passes: 0 }, 4, 4, "b")).toBeUndefined()
  })
})

// ─── tic-tac-toe ───

describe("tic-tac-toe", () => {
  test("detects rows, columns and diagonals", () => {
    expect(tttWinner(["X", "X", "X", null, null, null, null, null, null])).toBe("X")
    expect(tttWinner([null, null, null, "O", "O", "O", null, null, null])).toBe("O")
    expect(tttWinner(["X", null, null, null, "X", null, null, null, "X"])).toBe("X")
    // Anti-diagonal is 2-4-6; a board with X on 0-4-8 is a main-diagonal win.
    expect(tttWinner([null, null, "O", null, "O", null, "O", null, null])).toBe("O")
    expect(tttWinner(["X", null, "O", null, "O", null, "O", null, null])).toBe("O")
  })

  test("reports no winner on an empty or open board", () => {
    expect(tttWinner([null, null, null, null, null, null, null, null, null])).toBeUndefined()
    expect(tttWinner(["X", "O", null, "X", null, "O", null, null, null])).toBeUndefined()
  })

  test("a sharp AI takes an immediate win", () => {
    // X holds 0 and 2 with 1 empty between them, so the top row is one move from complete.
    const cells: Cell[] = ["X", null, "X", "O", null, "O", null, null, null]
    expect(tttBest(cells, "sharp")).toBe(1)
  })

  test("a sharp AI takes an immediate win as the second player", () => {
    // O holds 3, 5 and 7, so the middle row completes at 4.
    const cells: Cell[] = ["X", null, null, "O", null, "O", null, "O", null]
    expect(tttBest(cells, "sharp")).toBe(4)
  })

  test("a sharp AI blocks an immediate loss", () => {
    const cells: Cell[] = ["X", "X", null, "O", null, null, null, null, null]
    expect(tttBest(cells, "sharp")).toBe(2)
  })

  test("a sharp AI prefers the centre on an empty board", () => {
    expect(tttBest([null, null, null, null, null, null, null, null, null], "sharp")).toBe(4)
  })

  test("returns undefined when the board is full", () => {
    expect(tttBest(["X", "O", "X", "X", "O", "O", "O", "X", "X"], "sharp")).toBeUndefined()
  })

  test("never returns an occupied square, at any difficulty", () => {
    for (const difficulty of ["relaxed", "standard", "sharp"] as const) {
      const cells: Cell[] = [null, null, null, null, null, null, null, null, null]
      for (let attempt = 0; attempt < 60; attempt++) expect(cells[tttBest(cells, difficulty)!]).toBeNull()
    }
  })
})

// ─── checkers ───

describe("checkers", () => {
  const empty = () => Array.from({ length: 64 }, () => null) as any[]

  test("parses a square into a file and rank", () => {
    expect(checkersParse("b3")).toEqual({ file: 1, rank: 2 })
    expect(checkersParse("A8")).toEqual({ file: 0, rank: 7 })
    expect(checkersParse(" h1 ")).toEqual({ file: 7, rank: 0 })
  })

  test("rejects malformed squares", () => {
    for (const bad of ["", "b9", "i1", "b", "3b", "b3c3"]) expect(checkersParse(bad)).toBeUndefined()
  })

  test("a parsed square selects a piece that has a legal move", () => {
    // Regression: the parser used a single-group regex and read match[2], so every parsed
    // rank was NaN and no piece could ever be selected. This drives parser -> legal moves.
    const board = checkersInitial()
    const playable = checkersLegal(board, "b").map((move) => `${String.fromCharCode(97 + (move.from % 8))}${rankOf(move.from) + 1}`)
    expect(playable).toContain("b3")
    for (const square of playable.slice(0, 8)) {
      const parsed = checkersParse(square)!
      const match = checkersLegal(board, "b").find(
        (move) => rankOf(move.from) === parsed.rank && move.from % 8 === parsed.file,
      )
      expect(match).toBeDefined()
    }
  })

  test("starts with twelve men a side", () => {
    const board = checkersInitial()
    expect(board.filter((piece) => piece?.man === "b").length).toBe(12)
    expect(board.filter((piece) => piece?.man === "w").length).toBe(12)
  })

  test("every starting piece sits on a dark square", () => {
    const board = checkersInitial()
    for (let index = 0; index < 64; index++) {
      if (!board[index]) continue
      const rank = Math.floor(index / 8)
      const file = index % 8
      expect((rank + file) % 2).toBe(1)
    }
  })

  test("opening side has moves and neither side has won", () => {
    const board = checkersInitial()
    expect(checkersWon(board, "b")).toBe(false)
    expect(checkersWon(board, "w")).toBe(false)
    expect(checkersLegal(board, "b").length).toBeGreaterThan(0)
  })

  test("a capture is compulsory when one exists", () => {
    const stones = empty()
    // Red advances toward rank 7, so it jumps from rank 3 over rank 4 into rank 5.
    stones[8 * 3 + 4] = { man: "b", king: false }
    stones[8 * 4 + 3] = { man: "w", king: false }
    const forced = checkersLegal(stones, "b")
    expect(forced).toHaveLength(1)
    expect(forced[0]!.to).toBe(8 * 5 + 2)
    expect(checkersJumps(stones, 8 * 3 + 4)).toHaveLength(1)
  })

  test("ordinary steps are suppressed while a capture is available", () => {
    const stones = empty()
    stones[8 * 3 + 4] = { man: "b", king: false }
    stones[8 * 4 + 3] = { man: "w", king: false }
    stones[8 * 6 + 0] = { man: "b", king: false }
    // The man on rank 6 has quiet moves, but the compulsory jump wins.
    for (const move of checkersLegal(stones, "b")) expect(move.to).toBe(8 * 5 + 2)
  })

  test("applying a jump removes exactly the jumped piece", () => {
    const stones = empty()
    stones[8 * 3 + 4] = { man: "b", king: false }
    stones[8 * 4 + 3] = { man: "w", king: false }
    const next = checkersApply(stones, { from: 8 * 3 + 4, to: 8 * 5 + 2 })
    expect(next[8 * 4 + 3]).toBeNull()
    expect(next[8 * 3 + 4]).toBeNull()
    expect(next[8 * 5 + 2]).toEqual({ man: "b", king: false })
  })

  test("red crowning at rank 7 promotes to a king", () => {
    const stones = empty()
    stones[8 * 6 + 0] = { man: "b", king: false }
    expect(checkersApply(stones, { from: 8 * 6 + 0, to: 8 * 7 + 1 })[8 * 7 + 1]).toEqual({ man: "b", king: true })
  })

  test("blue crowning at rank 0 promotes to a king", () => {
    const stones = empty()
    stones[8 * 1 + 0] = { man: "w", king: false }
    expect(checkersApply(stones, { from: 8 * 1 + 0, to: 8 * 0 + 1 })[8 * 0 + 1]).toEqual({ man: "w", king: true })
  })

  test("a man does not crown on the wrong rank", () => {
    const stones = empty()
    stones[8 * 1 + 0] = { man: "b", king: false }
    expect(checkersApply(stones, { from: 8 * 1 + 0, to: 8 * 2 + 1 })[8 * 2 + 1]).toEqual({ man: "b", king: false })
  })

  test("a man moves forward only, a king both ways", () => {
    const man = empty()
    man[8 * 4 + 3] = { man: "b", king: false }
    // Red only ever increases rank.
    for (const move of checkersLegal(man, "b")) expect(move.to).toBeGreaterThan(8 * 4 + 3)

    const king = empty()
    king[8 * 4 + 4] = { man: "b", king: true }
    const kingMoves = checkersLegal(king, "b")
    expect(kingMoves.length).toBe(4)
    expect(kingMoves.some((move) => move.to > 8 * 4 + 4)).toBe(true)
    expect(kingMoves.some((move) => move.to < 8 * 4 + 4)).toBe(true)
  })

  test("red opens moving downward and blue opens moving upward", () => {
    const board = checkersInitial()
    for (const move of checkersLegal(board, "b")) expect(rankOf(move.to)).toBeGreaterThan(rankOf(move.from))
    for (const move of checkersLegal(board, "w")) expect(rankOf(move.to)).toBeLessThan(rankOf(move.from))
  })

  test("losing every piece ends the game", () => {
    const stones = empty()
    stones[0] = { man: "b", king: false }
    expect(checkersWon(stones, "w")).toBe(true)
    expect(checkersWon(stones, "b")).toBe(false)
  })

  test("every opening move lands on an empty dark square", () => {
    const board = checkersInitial()
    for (const move of checkersLegal(board, "b")) {
      const rank = Math.floor(move.to / 8)
      const file = move.to % 8
      expect((rank + file) % 2).toBe(1)
      expect(board[move.to]).toBeNull()
    }
  })
})