# Water Sort Solver

A small website that solves Water Sort puzzles (the "pour colored water until every tube holds one color" game). Type in a level or upload a screenshot of the game, and it shows the moves to solve it.

It started as a branch-off from an old project in my data structures and algorithms class: a Python breadth-first search using a deque and a visited set, rewritten in JavaScript so it runs in the browser.

## Use it

Open `index.html` in a browser. No build step or server is needed. You can also host the folder as-is on GitHub Pages.

- **Enter a level by hand:** tap colors into the tubes, or type the level as text: one word per tube, bottom to top, one letter per color (for example `oorb borb rbor - -`), with `-` for an empty tube.
- **Read a screenshot:** upload a screenshot of the game and the reader picks out the tubes and colors for you. It works on dark-background versions of the game such as [playwatersort.org](https://playwatersort.org). Light backgrounds and hidden "?" layers aren't supported yet.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page: level input, screenshot upload, and step-by-step solution |
| `solver.js` | The solver: BFS with a deque and visited set, falling back to best-first search for large puzzles |
| `reader.js` | Turns a screenshot into tubes and colors |
| `levels/` | Real 12 to 14 tube levels used for testing |
| `screenshots/` | Test screenshots for the reader |

## How the solver improves on the original version

- The goal test checks that every tube holds a single color, instead of checking alphabetical order and hard-coding the last moves.
- A pour moves the whole same-colored top run that fits, like the real game.
- Visited states keep tube boundaries and ignore tube order, so equivalent states aren't searched twice.
- Pointless moves are pruned, and big puzzles switch to best-first search so they don't run out of memory.

