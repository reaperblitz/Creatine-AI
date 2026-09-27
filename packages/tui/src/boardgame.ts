/**
 * Standalone board game player.
 *
 * Launched by the `/boardgame` TUI command, which spawns a *separate* terminal
 * window running this file so the main development session keeps running.
 * Run it directly with: `bun run packages/tui/src/boardgame.ts`
 *
 * This file is intentionally NOT part of the TUI module graph. Nothing imports
 * it; the TUI only resolves its path on disk.
 */
import { createInterface } from "node:readline"

const BOLD = "\u001b[1m"
const DIM = "\u001b[90m"
const CYAN = "\u001b[96m"
const GREEN = "\u001b[92m"
const YELLOW = "\u001b[93m"
const RED = "\u001b[91m"
const RESET = "\u001b[0m"

type Color = "w" | "b"

function clear() {
  process.stdout.write("\u001b[2J\u001b[3J\u001b[H")
}

/**
 * Line reader that buffers input, so a line arriving before its prompt is
 * displayed (piped input) is still consumed by the right question.
 */
export type Reader = { ask: (question: string) => Promise<string>; close: () => void }

function createReader(): Reader {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const buffered: string[] = []
  let waiting: ((line: string) => void) | undefined
  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting
      waiting = undefined
      resolve(line)
      return
    }
    buffered.push(line)
  })
  return {
    ask: (question) =>
      new Promise<string>((resolve) => {
        process.stdout.write(question)
        const ready = buffered.shift()
        if (ready !== undefined) {
          process.stdout.write(ready + "\n")
          resolve(ready)
          return
        }
        waiting = resolve
      }),
    close: () => rl.close(),
  }
}

function rule() {
  return `${DIM}${"─".repeat(56)}${RESET}`
}

function banner(title: string) {
  clear()
  console.log(`${BOLD}${CYAN}${title}${RESET}`)
  console.log(rule())
}

async function choose<T extends string>(
  reader: Reader,
  question: string,
  options: { label: string; value: T; hint?: string }[],
): Promise<T | undefined> {
  console.log(`\n${BOLD}${question}${RESET}`)
  options.forEach((option, index) => {
    const hint = option.hint ? ` ${DIM}${option.hint}${RESET}` : ""
    console.log(`  ${CYAN}${index + 1}${RESET}) ${option.label}${hint}`)
  })
  const answer = (await reader.ask(`\n${BOLD}#${RESET} `)).trim()
  if (answer === "") return undefined
  const index = Number.parseInt(answer, 10)
  if (Number.isNaN(index) || index < 1 || index > options.length) {
    console.log(`${RED}Pick a number between 1 and ${options.length}.${RESET}`)
    return choose(reader, question, options)
  }
  return options[index - 1]!.value
}

async function again(reader: Reader) {
  const answer = (await reader.ask(`\n${BOLD}Play again?${RESET} [y/N] `)).trim().toLowerCase()
  return answer === "y" || answer === "yes"
}

function turnName(color: Color) {
  return color === "w" ? `${BOLD}White${RESET}` : `${BOLD}Black${RESET}`
}

// Deliberately not a prompt: consuming a line here would desync piped input.
async function thinking() {
  process.stdout.write(`${DIM}AI is thinking...${RESET}`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  process.stdout.write("\n")
}

// ───────────────────────────── chess ─────────────────────────────

const CHESS_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 } as const
type ChessPieceType = keyof typeof CHESS_VALUE
type ChessPiece = { c: Color; t: ChessPieceType }
type ChessMove = { from: number; to: number; promote?: ChessPieceType; castle?: "k" | "q" }
type ChessState = {
  board: (ChessPiece | null)[]
  turn: Color
  castling: { wk: boolean; wq: boolean; bk: boolean; bq: boolean }
  ep: number
  quiet: number
}

const CHESS_FILES = "abcdefgh"
const CHESS_GLYPH: Record<Color, Record<ChessPieceType, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
}
const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
]
const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const ORTHOGONALS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
]
const ALL_STEPS = DIAGONALS.concat(ORTHOGONALS)

function chessInside(file: number, rank: number) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8
}

function chessAt(board: (ChessPiece | null)[], file: number, rank: number) {
  return chessInside(file, rank) ? board[rank * 8 + file] : undefined
}

function chessInitial(): ChessState {
  const backRank: ChessPieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"]
  const board: (ChessPiece | null)[] = Array.from({ length: 64 }, () => null)
  backRank.forEach((t, file) => {
    board[file] = { c: "b", t }
    board[56 + file] = { c: "w", t }
  })
  for (let file = 0; file < 8; file++) {
    board[8 + file] = { c: "b", t: "p" }
    board[48 + file] = { c: "w", t: "p" }
  }
  return { board, turn: "w", castling: { wk: true, wq: true, bk: true, bq: true }, ep: 0, quiet: 0 }
}

function chessAttacked(board: (ChessPiece | null)[], target: number, by: Color) {
  const file = target % 8
  const rank = (target / 8) | 0
  // White pawns attack toward the lower index, black pawns toward the higher
  // one, so a white attacker sits one rank *below* the target square.
  for (const step of [-1, 1]) {
    const pawn = chessAt(board, file + step, rank + (by === "w" ? 1 : -1))
    if (pawn?.c === by && pawn.t === "p") return true
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    const knight = chessAt(board, file + df, rank + dr)
    if (knight?.c === by && knight.t === "n") return true
  }
  for (const [df, dr] of DIAGONALS) {
    let f = file + df
    let r = rank + dr
    while (chessInside(f, r)) {
      const piece = board[r * 8 + f]
      if (piece) {
        if (piece.c === by && (piece.t === "b" || piece.t === "q")) return true
        break
      }
      f += df
      r += dr
    }
  }
  for (const [df, dr] of ORTHOGONALS) {
    let f = file + df
    let r = rank + dr
    while (chessInside(f, r)) {
      const piece = board[r * 8 + f]
      if (piece) {
        if (piece.c === by && (piece.t === "r" || piece.t === "q")) return true
        break
      }
      f += df
      r += dr
    }
  }
  // A king only attacks the eight squares around it, never along a ray.
  for (const [df, dr] of ALL_STEPS) {
    const king = chessAt(board, file + df, rank + dr)
    if (king?.c === by && king.t === "k") return true
  }
  return false
}

function chessKing(board: (ChessPiece | null)[], color: Color) {
  return board.findIndex((piece) => piece?.c === color && piece.t === "k")
}

function chessPseudo(state: ChessState, color: Color): ChessMove[] {
  const moves: ChessMove[] = []
  const enemy = color === "w" ? "b" : "w"
  const forward = color === "w" ? -1 : 1
  for (let from = 0; from < 64; from++) {
    const piece = state.board[from]
    if (!piece || piece.c !== color) continue
    const file = from % 8
    const rank = (from / 8) | 0
    const step = (df: number, dr: number): number[] => {
      const found: number[] = []
      let f = file + df
      let r = rank + dr
      while (chessInside(f, r)) {
        const occupant = state.board[r * 8 + f]
        if (occupant) {
          if (occupant.c !== color) found.push(r * 8 + f)
          break
        }
        found.push(r * 8 + f)
        f += df
        r += dr
      }
      return found
    }
    if (piece.t === "n") {
      for (const [df, dr] of KNIGHT_STEPS) {
        const to = chessInside(file + df, rank + dr) ? (rank + dr) * 8 + file + df : -1
        if (to !== -1 && state.board[to]?.c !== color) moves.push({ from, to })
      }
    }
    if (piece.t === "b" || piece.t === "q") {
      for (const [df, dr] of DIAGONALS) for (const to of step(df, dr)) moves.push({ from, to })
    }
    if (piece.t === "r" || piece.t === "q") {
      for (const [df, dr] of ORTHOGONALS) for (const to of step(df, dr)) moves.push({ from, to })
    }
    if (piece.t === "k") {
      for (const [df, dr] of ALL_STEPS) {
        const to = chessInside(file + df, rank + dr) ? (rank + dr) * 8 + file + df : -1
        if (to !== -1 && state.board[to]?.c !== color) moves.push({ from, to })
      }
      const home = color === "w" ? 7 : 0
      const base = home * 8 + 4
      if (from !== base) continue
      const kingSide = state.castling[color === "w" ? "wk" : "bk"]
      const queenSide = state.castling[color === "w" ? "wq" : "bq"]
      if (
        kingSide &&
        state.board[base + 3]?.t === "r" &&
        state.board[base + 3]?.c === color &&
        !state.board[base + 1] &&
        !state.board[base + 2] &&
        !chessAttacked(state.board, base, enemy) &&
        !chessAttacked(state.board, base + 1, enemy) &&
        !chessAttacked(state.board, base + 2, enemy)
      ) {
        moves.push({ from, to: base + 2, castle: "k" })
      }
      if (
        queenSide &&
        state.board[base - 4]?.t === "r" &&
        state.board[base - 4]?.c === color &&
        !state.board[base - 1] &&
        !state.board[base - 2] &&
        !state.board[base - 3] &&
        !chessAttacked(state.board, base, enemy) &&
        !chessAttacked(state.board, base - 1, enemy) &&
        !chessAttacked(state.board, base - 2, enemy)
      ) {
        moves.push({ from, to: base - 2, castle: "q" })
      }
    }
    if (piece.t !== "p") continue
    const last = color === "w" ? 0 : 7
    const addPawn = (f: number, r: number) => {
      if (!chessInside(f, r)) return
      if (r === last) {
        for (const promote of ["q", "r", "b", "n"] as const) moves.push({ from, to: r * 8 + f, promote })
        return
      }
      moves.push({ from, to: r * 8 + f })
    }
    if (!state.board[(rank + forward) * 8 + file]) {
      addPawn(file, rank + forward)
      // A two-square push is only legal from the pawn's home rank.
      const home = color === "w" ? 6 : 1
      const landing = (rank + forward * 2) * 8 + file
      if (rank === home && landing >= 0 && landing < 64 && !state.board[landing]) moves.push({ from, to: landing })
    }
    for (const df of [-1, 1]) {
      const victim = chessAt(state.board, file + df, rank + forward)
      if (victim?.c !== enemy) continue
      addPawn(file + df, rank + forward)
    }
  }
  if (state.ep === 0) return moves
  const rank = (state.ep / 8) | 0
  const file = state.ep % 8
  // The pawn that just double-pushed sits one rank past the ep square, and the
  // capturing pawn shares that rank on a neighbouring file. White's enemy sits
  // one rank lower on the board, black's one rank higher.
  const victimRank = color === "w" ? rank + 1 : rank - 1
  const victim = state.board[victimRank * 8 + file]
  if (victim?.c !== enemy || victim.t !== "p") return moves
  for (const df of [-1, 1]) {
    const pawn = chessAt(state.board, file + df, victimRank)
    if (pawn?.c === color && pawn.t === "p") moves.push({ from: victimRank * 8 + file + df, to: state.ep })
  }
  return moves
}

function chessApply(state: ChessState, move: ChessMove): ChessState {
  const board = state.board.slice()
  const piece = board[move.from]!
  // A pawn stepping diagonally onto an *empty* square is always an en passant capture.
  const enPassant =
    piece.t === "p" && !board[move.to] && (move.to % 8) !== (move.from % 8)
      ? ((move.to / 8) | 0) * 8 + (move.to % 8) + (piece.c === "w" ? 8 : -8)
      : -1
  const captured = enPassant === -1 ? board[move.to] : board[enPassant]
  if (enPassant !== -1) board[enPassant] = null
  board[move.from] = null
  board[move.to] = move.promote ? { c: piece.c, t: move.promote } : piece
  if (move.castle === "k") {
    board[move.to - 1] = board[move.to + 1]
    board[move.to + 1] = null
  }
  if (move.castle === "q") {
    board[move.to + 1] = board[move.to - 2]
    board[move.to - 2] = null
  }
  const castling = { ...state.castling }
  // Losing the king or one rook only forfeits the rights that piece served.
  if (move.from === 60 || move.to === 60) {
    castling.wk = false
    castling.wq = false
  }
  if (move.from === 63 || move.to === 63) castling.wk = false
  if (move.from === 56 || move.to === 56) castling.wq = false
  if (move.from === 4 || move.to === 4) {
    castling.bk = false
    castling.bq = false
  }
  if (move.from === 7 || move.to === 7) castling.bk = false
  if (move.from === 0 || move.to === 0) castling.bq = false
  const doublePawn = piece.t === "p" && (move.to % 8) === (move.from % 8) && Math.abs(move.to - move.from) === 16
  return {
    board,
    turn: state.turn === "w" ? "b" : "w",
    castling,
    ep: doublePawn ? (move.from + move.to) / 2 : 0,
    quiet: captured || doublePawn || move.promote ? 0 : state.quiet + 1,
  }
}

function chessLegal(state: ChessState, color: Color): ChessMove[] {
  const enemy = color === "w" ? "b" : "w"
  return chessPseudo(state, color).filter((move) => {
    const king = chessKing(chessApply(state, move).board, color)
    return king === -1 || !chessAttacked(chessApply(state, move).board, king, enemy)
  })
}

function chessIndex(square: string) {
  return (8 - Number(square[1])) * 8 + CHESS_FILES.indexOf(square[0])
}

function chessParse(input: string) {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(input.trim().toLowerCase().replace(/[\s-]/g, ""))
  if (!match) return undefined
  return {
    from: chessIndex(match[1]),
    to: chessIndex(match[2]),
    promote: match[3] as ChessPieceType | undefined,
  }
}

function chessMaterial(state: ChessState, color: Color): number {
  let score = 0
  for (let index = 0; index < 64; index++) {
    const piece = state.board[index]
    if (!piece) continue
    const rank = (index / 8) | 0
    const file = index % 8
    const homeward = piece.c === "w" ? 7 - rank : rank
    let value = CHESS_VALUE[piece.t]
    if (piece.t === "p") value += homeward * 6
    if ((piece.t === "n" || piece.t === "b") && homeward >= 2 && homeward <= 5) value += 14
    if ((piece.t === "n" || piece.t === "b") && (file === 2 || file === 5) && (homeward === 3 || homeward === 4)) {
      value += 16
    }
    score += piece.c === color ? value : -value
  }
  return score
}

function chessTerminal(state: ChessState, color: Color) {
  if (chessLegal(state, color).length === 0) return state.quiet > 2 ? "stalemate" : "checkmate"
  if (state.quiet >= 100) return "fifty"
  const material = state.board.reduce((sum, piece) => sum + (piece ? CHESS_VALUE[piece.t] : 0), 0)
  if (material < 2 * (CHESS_VALUE.b + CHESS_VALUE.n)) return "material"
  return undefined
}

function chessSearch(state: ChessState, color: Color, depth: number, alpha: number, beta: number): number {
  if (depth === 0 || state.quiet >= 100) return chessMaterial(state, color)
  const moves = chessLegal(state, color)
  if (moves.length === 0) return state.quiet > 2 ? 0 : -50000
  const enemy = color === "w" ? "b" : "w"
  let best = -Infinity
  for (const move of moves) {
    const value = -chessSearch(chessApply(state, move), enemy, depth - 1, -beta, -alpha)
    if (value > best) best = value
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

function chessBest(state: ChessState, color: Color, depth: number): ChessMove | undefined {
  const enemy = color === "w" ? "b" : "w"
  const ordered = chessLegal(state, color).sort((a, b) => {
    const value = (move: ChessMove) => {
      const target = state.board[move.to]
      const promotion = move.promote ? CHESS_VALUE[move.promote] - CHESS_VALUE.p : 0
      return promotion + (target ? CHESS_VALUE[target.t] : 0)
    }
    return value(b) - value(a)
  })
  let best: ChessMove | undefined
  let bestValue = -Infinity
  for (const move of ordered) {
    const next = chessApply(state, move)
    const value = depth <= 1 ? -chessMaterial(next, color) : -chessSearch(next, enemy, depth - 1, -Infinity, Infinity)
    if (best && value <= bestValue) continue
    best = move
    bestValue = value
  }
  return best
}

function chessRender(state: ChessState) {
  const header = `    ${CHESS_FILES.split("").join("  ")}`
  console.log(`${BOLD}${header}${RESET}`)
  for (let rank = 0; rank < 8; rank++) {
    const cells = Array.from({ length: 8 }, (_, file) => {
      const piece = state.board[rank * 8 + file]
      if (piece) return `${CHESS_GLYPH[piece.c][piece.t]}  `
      return (rank + file) % 2 === 0 ? `${DIM}\u2591\u2591\u2591${RESET}` : "   "
    })
    console.log(`${BOLD}${8 - rank}${RESET}  ${cells.join("")}`)
  }
  console.log(`${BOLD}${header}${RESET}`)
  console.log(`  ${DIM}♔♕♖♗♘♙ white    ♚♛♜♝♞♟ black${RESET}`)
}

async function playChess(reader: Reader, mode: "local" | "ai") {
  let state = chessInitial()
  const human: Color = "w"
  let result: string | undefined
  while (result === undefined) {
    const moves = chessLegal(state, state.turn)
    const terminal = chessTerminal(state, state.turn)
    banner("Chess")
    chessRender(state)
    if (terminal) {
      result =
        terminal === "stalemate"
          ? "Draw by stalemate."
          : terminal === "fifty"
            ? "Draw by the fifty-move rule."
            : terminal === "material"
              ? "Draw by insufficient material."
              : `${turnName(state.turn === "w" ? "b" : "w")} wins by checkmate.`
      break
    }
    const isAI = mode === "ai" && state.turn !== human
    console.log(`\n  Turn: ${turnName(state.turn)}${isAI ? ` ${DIM}(AI)${RESET}` : ""}`)
    if (isAI) {
      await thinking()
      const move = chessBest(state, state.turn, 3)
      if (!move) {
        result = `${turnName(state.turn)} has no legal move.`
        break
      }
      state = chessApply(state, move)
      continue
    }
    const raw = await reader.ask(`  ${BOLD}Move${RESET} ${DIM}(e2e4, e7e8q to promote, "resign" to quit)${RESET} `)
    const text = raw.trim().toLowerCase()
    if (text === "resign" || text === "quit" || text === "exit") {
      result = `${turnName(state.turn)} resigned.`
      break
    }
    const parsed = chessParse(raw)
    const match = parsed
      ? moves.find(
          (move) =>
            move.from === parsed.from &&
            move.to === parsed.to &&
            (!parsed.promote || move.promote === parsed.promote),
        )
      : undefined
    if (!match) {
      console.log(`  ${RED}Illegal move.${RESET} Try something like ${BOLD}e2e4${RESET}.`)
      continue
    }
    state = chessApply(state, match)
  }
  console.log(`\n  ${GREEN}${BOLD}${result}${RESET}\n`)
  return again(reader)
}


// ────────────────────────────── go ──────────────────────────────

type GoBoard = { stones: ("b" | "w" | null)[]; ko: number; passes: number }

const GO_SIZE = 9
const GO_COLUMNS = "abcdefghi"
const GO_NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]
/** Orthogonal only: Go liberties and empty regions never join diagonally. */
const GO_ADJACENT = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

function goInside(rank: number, file: number) {
  return rank >= 0 && rank < GO_SIZE && file >= 0 && file < GO_SIZE
}

function goGroup(board: GoBoard, rank: number, file: number) {
  const color = board.stones[rank * GO_SIZE + file]!
  const seen = new Set<number>([rank * GO_SIZE + file])
  const group: number[] = []
  const liberties = new Set<number>()
  const queue = [rank * GO_SIZE + file]
  while (queue.length > 0) {
    const index = queue.pop()!
    group.push(index)
    const r = (index / GO_SIZE) | 0
    const f = index % GO_SIZE
    // A group is connected through diagonals as well as orthogonal steps.
    for (const [dr, df] of GO_NEIGHBOURS) {
      if (!goInside(r + dr, f + df)) continue
      const neighbour = (r + dr) * GO_SIZE + (f + df)
      if (board.stones[neighbour] === color && !seen.has(neighbour)) {
        seen.add(neighbour)
        queue.push(neighbour)
      }
    }
    for (const [dr, df] of GO_ADJACENT) {
      if (!goInside(r + dr, f + df)) continue
      const neighbour = (r + dr) * GO_SIZE + (f + df)
      if (!board.stones[neighbour]) liberties.add(neighbour)
    }
  }
  return { group, liberties }
}

function goPlay(board: GoBoard, rank: number, file: number, color: "b" | "w"): GoBoard | undefined {
  if (!goInside(rank, file)) return undefined
  const index = rank * GO_SIZE + file
  if (board.stones[index]) return undefined
  const stones = board.stones.slice()
  stones[index] = color
  const next: GoBoard = { stones, ko: -1, passes: 0 }
  const enemy = color === "b" ? "w" : "b"
  const captured: number[] = []
  for (const [dr, df] of GO_NEIGHBOURS) {
    if (!goInside(rank + dr, file + df)) continue
    if (next.stones[(rank + dr) * GO_SIZE + (file + df)] !== enemy) continue
    const { group, liberties } = goGroup(next, rank + dr, file + df)
    if (liberties.size > 0) continue
    for (const stone of group) {
      if (next.stones[stone] === enemy) {
        next.stones[stone] = null
        captured.push(stone)
      }
    }
  }
  if (goGroup(next, rank, file).liberties.size === 0) return undefined
  if (captured.length === 1 && board.ko === captured[0]) return undefined
  return { ...next, ko: captured.length === 1 ? captured[0] : -1 }
}

function goScore(board: GoBoard) {
  // -1 unknown, -2 claimed empty region, 0 black, 1 white
  const owner = new Int8Array(GO_SIZE * GO_SIZE).fill(-1)
  for (let index = 0; index < board.stones.length; index++) {
    if (board.stones[index]) owner[index] = board.stones[index] === "b" ? 0 : 1
  }
  for (let start = 0; start < owner.length; start++) {
    if (owner[start] !== -1) continue
    const region: number[] = []
    const borders = new Set<"b" | "w">()
    owner[start] = -2
    region.push(start)
    while (region.length > 0) {
      const current = region.pop()!
      const r = (current / GO_SIZE) | 0
      const f = current % GO_SIZE
      for (const [dr, df] of GO_ADJACENT) {
        if (!goInside(r + dr, f + df)) continue
        const neighbour = (r + dr) * GO_SIZE + (f + df)
        const stone = board.stones[neighbour]
        if (stone) borders.add(stone)
        else if (owner[neighbour] === -1) {
          owner[neighbour] = -2
          region.push(neighbour)
        }
      }
    }
    const color = [...borders]
    if (color.length !== 1) continue
    for (let index = 0; index < owner.length; index++) {
      if (owner[index] === -2) owner[index] = color[0] === "b" ? 0 : 1
    }
  }
  let black = 0
  let white = 0
  for (const value of owner) {
    if (value === 0) black++
    if (value === 1) white++
  }
  return { black, white }
}

function goMoveValue(board: GoBoard, color: "b" | "w", rank: number, file: number) {
  const next = goPlay(board, rank, file, color)
  if (!next) return undefined
  const enemy = color === "b" ? "w" : "b"
  let value = 0
  let captured = 0
  for (let index = 0; index < board.stones.length; index++) {
    if (board.stones[index] === enemy && next.stones[index] === null) captured++
  }
  const centre = (GO_SIZE - 1) / 2
  value += (GO_SIZE - 1) * 2 - (Math.abs(rank - centre) + Math.abs(file - centre)) * 3
  value += captured * 30
  value += Math.min(goGroup(next, rank, file).liberties.size, 4) * 3
  for (const [dr, df] of GO_ADJACENT) {
    if (!goInside(rank + dr, file + df)) continue
    const neighbour = next.stones[(rank + dr) * GO_SIZE + (file + df)]
    if (neighbour === color) value += 2
    if (neighbour === enemy) value -= 2
  }
  return value
}

function goBest(board: GoBoard, color: "b" | "w") {
  let best: { rank: number; file: number } | undefined
  let bestValue = -Infinity
  for (let rank = 0; rank < GO_SIZE; rank++) {
    for (let file = 0; file < GO_SIZE; file++) {
      const value = goMoveValue(board, color, rank, file)
      if (value === undefined) continue
      if (best && value <= bestValue) continue
      best = { rank, file }
      bestValue = value
    }
  }
  return best
}

function goParse(input: string) {
  const match = /^([a-i])([1-9])$/.exec(input.trim().toLowerCase())
  if (!match) return undefined
  return { rank: GO_SIZE - Number(match[2]), file: GO_COLUMNS.indexOf(match[1]) }
}

function goRender(board: GoBoard) {
  console.log(`${BOLD}    ${GO_COLUMNS.split("").join(" ")}${RESET}`)
  for (let rank = 0; rank < GO_SIZE; rank++) {
    const cells = Array.from({ length: GO_SIZE }, (_, file) => {
      const stone = board.stones[rank * GO_SIZE + file]
      const glyph = stone === "b" ? "●" : stone === "w" ? "○" : "\u00b7"
      return `${stone === "b" ? BOLD : stone === "w" ? YELLOW : DIM}${glyph}${RESET}`
    })
    console.log(`${BOLD}${String(GO_SIZE - rank).padStart(3)}${RESET} ${cells.join(` ${DIM}\u2502${RESET} `)}`)
  }
  console.log(`  ${DIM}● black   ○ white   · empty${RESET}`)
}

async function playGo(reader: Reader, mode: "local" | "ai") {
  let board: GoBoard = { stones: Array.from({ length: GO_SIZE * GO_SIZE }, () => null), ko: -1, passes: 0 }
  let turn: "b" | "w" = "b"
  const human: "b" | "w" = "b"
  let result: "black" | "white" | "draw" | undefined
  while (result === undefined) {
    banner(`Go  ${DIM}9 x 9 board${RESET}`)
    goRender(board)
    if (board.passes >= 2) {
      const score = goScore(board)
      result = score.black === score.white ? "draw" : score.black > score.white ? "black" : "white"
      break
    }
    const isAI = mode === "ai" && turn !== human
    const label = turn === "b" ? `${BOLD}Black${RESET}` : `${BOLD}White${RESET}`
    console.log(`\n  Turn: ${label}${isAI ? ` ${DIM}(AI)${RESET}` : ""}`)
    if (isAI) {
      await thinking()
      const move = goBest(board, turn)
      const next = move ? goPlay(board, move.rank, move.file, turn) : undefined
      board = next ? { ...next, passes: 0 } : { ...board, ko: -1, passes: board.passes + 1 }
      turn = turn === "b" ? "w" : "b"
      continue
    }
    const raw = await reader.ask(`  ${BOLD}Stone${RESET} ${DIM}(e5, "pass" to pass, "resign" to quit)${RESET} `)
    const text = raw.trim().toLowerCase()
    if (text === "resign" || text === "quit" || text === "exit") {
      result = turn === "b" ? "white" : "black"
      break
    }
    if (text === "pass") {
      board = { ...board, ko: -1, passes: board.passes + 1 }
      turn = turn === "b" ? "w" : "b"
      continue
    }
    const parsed = goParse(text)
    if (!parsed) {
      console.log(`  ${RED}Not an intersection.${RESET} Columns a-i, rows 1-9.`)
      continue
    }
    const next = goPlay(board, parsed.rank, parsed.file, turn)
    if (!next) {
      console.log(`  ${RED}Illegal.${RESET} No suicide, and the ko point is blocked.`)
      continue
    }
    board = { ...next, passes: 0 }
    turn = turn === "b" ? "w" : "b"
  }
  const score = goScore(board)
  const detail = `${DIM}black ${score.black} : ${score.white} white${RESET}`
  if (result === "draw") console.log(`\n  ${YELLOW}${BOLD}Draw.${RESET} ${detail}\n`)
  else if (result === "black") console.log(`\n  ${GREEN}${BOLD}Black wins.${RESET} ${detail}\n`)
  else console.log(`\n  ${GREEN}${BOLD}White wins.${RESET} ${detail}\n`)
  return again(reader)
}

// ───────────────────────────── entry ─────────────────────────────

async function main() {
  const reader = createReader()
  try {
    let replay = true
    while (replay) {
      clear()
      console.log(`${BOLD}${CYAN}Board Game${RESET}`)
      console.log(rule())
      const game = await choose(reader, "Pick a game:", [
        { label: "Chess", value: "chess" as const },
        { label: "Go", value: "go" as const },
      ])
      const mode = game
        ? await choose(reader, "How do you want to play?", [
            { label: "Local multiplayer", value: "local" as const, hint: "two people, one keyboard" },
            { label: "Play against the AI", value: "ai" as const, hint: "you take the first side" },
          ])
        : undefined
      if (!game || !mode) {
        console.log(`\n  ${DIM}Bye.${RESET}\n`)
        return
      }
      replay = game === "chess" ? await playChess(reader, mode) : await playGo(reader, mode)
    }
    clear()
    console.log(`\n  ${DIM}Thanks for playing.${RESET}\n`)
  } finally {
    reader.close()
  }
}

await main()
