---
id: private-apps
title: Running apps open only through Chef
status: building
entrypoint: app/<project>/<session>
acceptance:
  - id: AC1
    text: Each running app gets an address from one app router Worker per Chef install, and opening that address without coming through Chef shows a page that says to open it from Chef
  - id: AC2
    text: Chef's app link sends the visitor through a link into the app that works for two minutes and on that address only; the router remembers the visitor with a cookie that also works inside the dashboard's frame
  - id: AC3
    text: The key that signs these links lives in the engine and in the router's bindings only; the sandbox and the app never see it
  - id: AC4
    text: Proofs reach the branch's app inside its own sandbox, so they need no pass
---

The router only forwards to the branch's sandbox and strips its cookie before the app sees the request; the user's app itself never runs on Workers.
