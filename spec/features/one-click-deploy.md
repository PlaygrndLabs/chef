---
id: one-click-deploy
title: One-click deploy to Cloudflare
status: building
entrypoint: deploy
acceptance:
  - id: AC1
    text: The Deploy to Cloudflare button, the deploy workflow and a deploy from a computer all run the same deploy script from the repository root
  - id: AC2
    text: The deploy creates the memory index when it is missing and needs no other manual Cloudflare setup
  - id: AC3
    text: A named deploy gets its own Artifacts namespace, Workflow, memory index and preview Workers, so several chefs can share an account
  - id: AC4
    text: An example CHEF_PASSWORD is never accepted as the password
---

Every green ci run on main deploys the main Chef through this script.
