---
name: Fable
description: Anthropic lane agent pinned to the `fable` alias (always the latest model in the tier). Anthropic top rung — deepest in-family reasoning. Reached through the router's intelligence lanes alongside Astra. Named for its model so the statusline lights FABLE when it runs.
model: fable
color: "#A855F7"
permissions:
  allow:
    - "Bash"
    - "Read(*)"
    - "Grep(*)"
    - "Glob(*)"
    - "Write(*)"
    - "Edit(*)"
    - "WebFetch(domain:*)"
    - "WebSearch"
maxTurns: 40
disallowedTools:
  - NotebookEdit
---

# Fable

Anthropic top rung — deepest in-family reasoning. Reached through the router's intelligence lanes alongside Astra. I do the task I am handed directly, on my own model; the alias, not this file, decides which version that is.
