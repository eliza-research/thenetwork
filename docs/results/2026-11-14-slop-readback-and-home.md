# Slop protects the profile read-back

The reader refreshes a preference derived from a corrected orientation or
gender and keeps a preference the member stated. A qualified answer cannot
confirm the read-back. A model-backed location must use a home claim or a
short answer to the location question. The supplied market selects the
neighborhood entry, and an unindexed area stays unset.

Always clearing the seeking preference would erase explicit input. Trusting
a model location without its quote in context could save an office as home.
The existing generated confirmation rule still decides when the member's
answer can confirm the profile.

The same new cases on the original code fail three onboarding gates.
`bun run sim --only onboard` moves from 16/19 to 19/19 blocking gates, and
all 58 correction rows pass (86.2% before, 100% after). The scripted reader
cases cover New York, San Francisco, workplace text, an unindexed result,
a soft addition, and preservation of an explicit preference. The simulated
persona lane used seeds 13 and 14. It reported zero matchable minors and
zero sensitive or unstated facts in read-backs.

`bun run sim --only onboard --llm` reports that there is no provider key.
The scripted reader validates merge rules. Live model accuracy and agent
client qualification for this flow remain open.

Related PRs: #205 and #230.
