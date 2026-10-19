---
id: branch-apps
title: Each branch runs its whole app in its sandbox
status: building
entrypoint: app/<project>/<session>
acceptance:
  - id: AC1
    text: A session's sandbox runs its branch's whole stack in Docker from the repo's compose file when it has one (compose.yaml, compose.yml, docker-compose.yaml or docker-compose.yml), with the project's env values, after each commit
  - id: AC2
    text: main has its own sandbox that runs main's app, the release candidate, and starts it again when main moves
  - id: AC3
    text: The app's status (starting, running, failed or no-stack) and address are recorded on the session from the first commit
  - id: AC4
    text: A branch without a compose file or wrangler config shows that it has no app to run, with a Dockerize the project button that asks Chef to add one
  - id: AC5
    text: A Cloudflare Workers project (a wrangler config at the root and no compose file), like every project made from Chef's template, runs in its sandbox with wrangler dev and the project's env values, with no Docker
---

Chef deploys nothing of the user's app to Cloudflare; the user connects their own repo to their real production. A sandbox that sleeps wakes and starts the app again when someone opens it.
