---
id: branch-apps
title: Each branch runs its whole app in its sandbox
status: building
entrypoint: app/<project>/<session>
acceptance:
  - id: AC1
    text: A session's sandbox runs its branch's whole stack in Docker from the repo's compose file (compose.yaml, compose.yml, docker-compose.yaml or docker-compose.yml), with the project's env values, after each commit
  - id: AC2
    text: main has its own sandbox that runs main's app, the release candidate, and starts it again when main moves
  - id: AC3
    text: The app's status (starting, running, failed or no-stack) and address are recorded on the session from the first commit
  - id: AC4
    text: A branch without a compose file shows that it has no app to run and how to add one
---

Chef deploys nothing of the user's app to Cloudflare; the user connects their own repo to their real production. A sandbox that sleeps wakes and starts the app again when someone opens it.
