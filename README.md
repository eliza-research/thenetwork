# The Network

Prototypes, research, and test harnesses for The Network: an invite-only, messaging-first AI that finds and activates the latent potential between people.

- **PRD (canonical):** https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit
- **Prototype plan:** [docs/prototypes.md](docs/prototypes.md)
- **Test, validation and verification plan:** [docs/test-plan.md](docs/test-plan.md)
- **Research:** [docs/research/](docs/research/)

## Setup

```bash
cp .env.example .env   # add CEREBRAS_API_KEY
bun install
```

Testing and validation use Cerebras `qwen-3.8-27b` for now (configured in `.env`); the model will be swapped later.
