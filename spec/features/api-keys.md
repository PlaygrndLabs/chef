---
id: api-keys
title: Passwords for browsers, API keys for programs
status: building
entrypoint: settings
acceptance:
  - id: AC1
    text: The password signs in from a browser only; a request that sends it as a Bearer token is refused and told to use an API key
  - id: AC2
    text: Settings > API keys makes a named key that is shown once, can end after a set time and can be revoked on its own; chef keeps only its hash
  - id: AC3
    text: chef deploy --api-key makes a key for an app that manages chef, sends it as CHEF_API_KEY and replaces the key an earlier deploy made
  - id: AC4
    text: Only a managing app's key may say which person a request acts for and which address its links use; chef drops both from any other caller
  - id: AC5
    text: A chef with a key but no password shows no sign-in or setup page, and sends browsers to CHEF_HOME when it is set
  - id: AC6
    text: Every key carries a list of scopes, so narrower keys and share links reuse the same check
---

A key looks like chef_<id>_<secret>, so chef finds it by id without trying every key, and a leaked key is easy to recognize.
