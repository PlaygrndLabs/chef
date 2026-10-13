---
id: local-app
title: Local app with work in the cloud
status: building
entrypoint: startApp
acceptance:
  - id: AC1
    text: pnpm start serves the dashboard on localhost and connects it to a chef in Cloudflare by its address and password, claiming the password when that chef has none
  - id: AC2
    text: Every API call, live WebSocket and preview link goes to the chef in Cloudflare with the password added, and the password never reaches the browser
  - id: AC3
    text: The local app refuses requests from other sites and other host names
  - id: AC4
    text: Sessions, sandboxes, previews and settings stay in Cloudflare, so work goes on while the computer sleeps
---

Terminal and desktop apps are planned as further clients of the same API.
