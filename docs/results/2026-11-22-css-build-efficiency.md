# CSS build efficiency

The design-system build and check ran a Node process for each of four
brands. The CSS build also rewrote the aggregate styles and connector
stylesheet on every run. The build now calls the Vibestack token library in
one process. The writers compare the generated text with the file before
they write it.

## Measurements

The same worktree and inputs were used for five alternating before and after
pairs for each command. The samples ran with Node 26.13.0 and pnpm 10.24.0
on an 18-core Apple Silicon host with other work active. The timer was
`/usr/bin/time -p corepack pnpm@10.24.0 run <command>`. Processor time is
user plus system time. The commands use no model provider or simulation
seed.

| Command | Before processor median and range | After processor median and range | Before and after elapsed median |
| --- | ---: | ---: | ---: |
| `design:build` | 0.86 s (0.84–0.87) | 0.54 s (0.53–0.55) | 0.97 s and 0.75 s |
| `design:check` | 0.85 s (0.83–0.86) | 0.53 s (0.51–0.54) | 0.94 s and 0.85 s |
| `connector:css` | 2.32 s (2.28–2.37) | 2.02 s (2.00–2.09) | 4.27 s and 4.45 s |

The connector elapsed ranges overlap. The processor time ranges are separate
in all three commands. The independent work removed from each command is
four Node starts. Each warm connector build reduced output writes from
three CSS files to zero. Each warm design build reduced writes from two CSS
files to zero.

All timed commands exited zero. All warm and clean connector builds made the
same 15 CSS and design-document outputs. A SHA-256 of their sorted paths and
file digests was `cd83ffc8adad47090f6319e7d93c191495f3e4a845176912ec0db14653f13043`.
The check still reads and assesses the token inputs. The build regenerates
the text before it compares each existing file.

## Alternatives

Running the four commands in parallel could reduce elapsed time on idle
hosts. It still starts four Node processes and adds work to busy runners.
An input cache could skip token generation. That would require a durable
record of all templates and inputs. The chosen change shares the existing
generator and compares its outputs directly.
