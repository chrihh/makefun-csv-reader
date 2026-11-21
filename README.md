# makefun-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/chrihh/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/chrihh/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0, for the bounty "Read
broken CSV files faster, 21 November 2026". `solve.js` exports `run(input)`
and returns exactly csv-reader's answer for every input `{text, header}` —
the same `{columns, rows, errors}`, with the same broken-row policy: a
leading BOM dropped, stray CRs dropped outside quotes, doubled quotes and
CRLF/lone CR read as LF inside quotes, junk after a closing quote appended,
an unterminated quote re-read as a literal, and rows padded or cut to the
first record's width with `short_row` / `long_row` errors in the order met.

It is faster by reading differently, not by reading less: the reference
builds every field character by character, while this reader scans with
`indexOf` for the next comma, line break, quote or CR, slices each plain
run of a field in one piece, keeps the next CR and the next quote as
monotonic pointers so no text is rescanned, and takes a plain-record path
— one slice of the whole line, split on commas — for records with no quote
and no CR but their line ending. On the kit's practice set (6 cases,
~10 MB of CSV) it answers identically to the reference on every case and
runs several times faster in `run()`; the whole harness process, JSON
included, takes roughly half the baseline's CPU.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

where `input/cases.json` is a JSON array of `{"id", "input"}` cases in the
contest's format; `out/answers.json` is written with one answer per case,
in the cases' order. Node 22, no dependencies.

---

<sub>Entered on [make.fun](https://make.fun/?ref=44n6pkpv&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
