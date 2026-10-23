Measured with `npm run compare -- --latency=80` on 2026-10-23; data source: snapshot; simulated latency per request: 80 ms.

**Character card**: Who is Luke Skywalker, where are they from, and which films are they in?

| strategy | requests | round trips | received | x needed | data calls | time (ms) | same answer |
|---|---|---|---|---|---|---|---|
| REST, follow links | 6 | 2 | 13.7 KB | 100.1x | 6 | 182 | yes |
| REST + ?fields | 6 | 2 | 371 B | 2.6x | 6 | 179 | yes |
| REST + ?expand | 1 | 1 | 13.1 KB | 95.6x | 3 | 85 | yes |
| GraphQL | 1 | 1 | 209 B | 1.5x | 3 | 85 | yes |

**Film credits**: Who appears in A New Hope, and where is each of them from?

| strategy | requests | round trips | received | x needed | data calls | time (ms) | same answer |
|---|---|---|---|---|---|---|---|
| REST, follow links | 29 | 3 | 17.1 KB | 20.2x | 29 | 294 | yes |
| REST + ?fields | 29 | 3 | 2.2 KB | 2.6x | 29 | 275 | yes |
| REST + ?expand | 11 | 2 | 9.9 KB | 11.7x | 12 | 174 | yes |
| GraphQL | 1 | 1 | 1.0 KB | 1.2x | 3 | 85 | yes |

**Planet directory**: What is the name and population of every planet?

| strategy | requests | round trips | received | x needed | data calls | time (ms) | same answer |
|---|---|---|---|---|---|---|---|
| REST, follow pages | 6 | 6 | 25.8 KB | 10.1x | 6 | 505 | yes |
| REST + ?fields&limit | 1 | 1 | 2.6 KB | 1.0x | 1 | 84 | yes |
| GraphQL | 1 | 1 | 2.4 KB | 0.9x | 1 | 87 | yes |

**Search everything**: What in the whole dataset has "sky" in its name?

| strategy | requests | round trips | received | x needed | data calls | time (ms) | same answer |
|---|---|---|---|---|---|---|---|
| REST, six searches | 6 | 1 | 2.5 KB | 36.3x | 6 | 98 | yes |
| REST + ?fields | 6 | 1 | 416 B | 5.9x | 6 | 90 | yes |
| GraphQL | 1 | 1 | 216 B | 3.0x | 6 | 90 | yes |
