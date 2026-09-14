import { Board } from "@/components/board";
import { Lobby } from "@/components/lobby";
import { emptyState } from "@/lib/game";
export default function Home() {
  const board = emptyState();
  board.board = [[1,2,2,1,2,1,2],[0,1,2,2,1,2,0],[0,0,1,1,2,0,0],[0,0,0,1,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]];
  board.winningCells = [[0,0],[1,1],[2,2],[3,3]];
  board.moves = 16;
  board.status = "won";
  board.winner = 1;
  return <><main className="home-layout"><section className="home-copy"><div className="event-label"><span className="event-cross" aria-hidden="true">+</span>TOKYO GAME SHOW · PLAY TOGETHER</div><h1>CONNECT<br /><span>FOUR.</span></h1><p className="home-lede">Two players. Four in a row.<br />Your next rival is right here.</p><p className="home-japanese" lang="ja">4つ並べて、勝負しよう。</p><Lobby /></section><section className="home-board" aria-label="Connect Four example"><div className="board-overline"><span>THE CLASSIC. A NEW KIND OF ENGINE.</span><span aria-hidden="true">↙</span></div><Board state={board} /><div className="sample-caption">EXAMPLE POSITION <span>MAKE YOUR OWN WINNING MOVE</span></div><div className="home-actor-note"><div className="actor-glyph" aria-hidden="true">A</div><div><strong>Your match gets its own actor.</strong><p>One board. One state. Powered by AppThrust.</p></div><span className="note-line" aria-hidden="true" /></div></section></main><footer className="home-footer"><span>Built to play. Powered by <strong>AppThrust.</strong></span><span>7 COLUMNS <b>×</b> 6 ROWS <b>→</b> 4 TO WIN</span></footer></>;
}
