---
id: private-previews
title: Previews open only through chef
status: building
entrypoint: preview/<feature>
acceptance:
  - id: AC1
    text: Every preview build puts a gate in front of the app, and opening a preview's own address without coming through chef shows a page that says to open it from chef
  - id: AC2
    text: chef's preview link sends the visitor through a link into the preview that works for two minutes and on that preview only; the preview remembers the visitor with a cookie that also works inside the dashboard's frame
  - id: AC3
    text: The key that signs these links lives in the engine and in the previews' base config only; the build sandbox never sees it and the app gets its env without it
  - id: AC4
    text: Proofs reach the preview with a pass that the sandbox's outbound handler adds, so proofs keep working without the sandbox holding a pass
  - id: AC5
    text: A preview built before the gate is built again with it on its next visit
---

The gate re-exports the app's own entry module, so Durable Objects and other handlers keep working, and it strips its cookie and pass header before the app sees the request.
