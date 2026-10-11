---
id: todo-add
title: Add an item to a todo list
status: building
entrypoint: POST /todos
revision: 1
acceptance:
  - id: AC1
    text: POST /todos adds an item and returns it
  - id: AC2
    text: GET /todos lists added items in order
  - id: AC3
    text: an empty item is rejected
---

A user adds an item to their todo list and sees it in the list.
