---
id: project-environment
title: Keys and settings per project
status: building
entrypoint: ProjectAgent.envRequest
acceptance:
  - id: AC1
    text: Each project keeps its own environment variables, plain or secret, set one by one or by pasting a .env file, and secrets are never shown again after saving
  - id: AC2
    text: Values are stored encrypted in the project and never reach git, Artifacts, the coder sandbox or the agents; agents only see the names
  - id: AC3
    text: The planner lists the names a feature reads in its spec entry and the app reads them from context.env
  - id: AC4
    text: Every running app of the project gets the values, and changing one starts the apps that are awake again with them
  - id: AC5
    text: A session whose feature needs a key that is not set waits before its gate, shows which keys it needs, and carries on by itself once they are saved
---

Settings live under "Environment and secrets" in the project dialog; the feature page asks for a missing key in place.
