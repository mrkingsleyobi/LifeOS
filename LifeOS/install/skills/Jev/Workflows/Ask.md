# Ask Workflow

One typed judgment

1. Write the question so the answer space is closed. Reference state fields in backticks (`` `prompt` ``).
2. Keep the state tight. Irrelevant context lowers accuracy, and the limit is 32k tokens of state.
3. Report the probability, not only the label. Below 0.6 (noul) or low `confidence` (choice/score) means unsure: say so, or escalate to a model that can reason.
