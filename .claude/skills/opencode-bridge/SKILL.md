---
name: opencode-bridge
description: Use when delegating coding, research, or review work to OpenCode through the opencode-bridge MCP server (tools named opencode_task, opencode_wait, opencode_respond, opencode_status, opencode_cancel, opencode_health), when a user asks to "hand this to OpenCode", run work on another model, fan out parallel workers, or when an opencode_* call returns timeout, failed, pendingPermission, or "OpenCode service not found".
---

# OpenCode Bridge

## Overview

The bridge lets you hand a task to an OpenCode worker session and **read its final answer back**. Sessions live in the user's local OpenCode background service (their models, auth, agents), not in the bridge, so they survive bridge restarts.

**Core rule:** `opencode_task` and `opencode_respond` only *start* work. Nothing is done until `opencode_wait` returns `status: "succeeded"`.

## The loop

```
opencode_task  { task, directory?, agent?, model?, title? }  -> { sessionId, status: "working" }
opencode_wait  { sessionId, timeoutMs? }                     -> { status, result, cost, tokens }
opencode_respond { sessionId, message }                      -> follow-up turn, then wait again
opencode_cancel  { sessionId }                               -> stop it
```

1. **Write a self-contained task.** The worker cannot see your conversation, files you read, or the user's request. Put in: the goal, the exact files/paths, constraints, and what to put in its final reply (e.g. "end with a list of files you changed").
2. **Pick the directory.** Omitted → a sandbox `workdir/` inside the bridge package. To work on a real project you MUST pass `directory` as an absolute path (e.g. `"E:\\projects\\myapp"`). It is fixed for the session's lifetime; a new directory needs a new task.
3. **Wait.** Call `opencode_wait`. Default timeout 5 min, max 3,600,000 ms.
4. **Follow up in the same session** with `opencode_respond` + `opencode_wait`. The session keeps full context; don't start a new task to refine the same work.
5. **Verify.** `result` is the worker's *claim*. Read the changed files or run the tests yourself before telling the user it worked.

## Reading `opencode_wait` results

| `status` | Meaning | Do |
|---|---|---|
| `succeeded` | Worker finished | Use `result`; verify side effects |
| `timeout` | Still running; nothing is wrong | Call `opencode_wait` again with the same `sessionId`. Do not cancel or restart |
| `failed` | Model/provider error | Read `error`; fix the task, model, or auth, then `opencode_respond` or start fresh |
| `interrupted` | Cancelled (by you or the user) | Respond to resume, or report it |

- `result` is only the **last assistant message's text**: no tool output, no reasoning, no earlier turns. If you need a diff or file list, ask for it in the task.
- `result` is capped at 100,000 chars; `truncated: true` means it was cut. Ask the worker to write long output to a file and read the file.
- `cost` and `tokens` come from the last turn.

## Status, permissions, health

- `opencode_status` with no args: tracked + recent sessions (`limit` default 10, max 50). With `sessionId`: one session's `busy`/`idle`, `outcome`, `directory`, cost.
- **`pendingPermission` in status means the worker is blocked on an approval.** The bridge has no tool to answer it. Tell the user to approve or deny it in OpenCode (TUI/web) for that session; waiting longer will not unblock it. Check status when a wait keeps timing out.
- `opencode_health`: service url/version and `subscriptionActive`. Run it first when calls error.

## Options

| Param | Format | Notes |
|---|---|---|
| `agent` | `"build"` \| `"plan"` \| `"explore"` \| a user agent | `plan`/`explore` for read-only analysis; `build` edits files. Omit for the user's default agent |
| `model` | `"provider/model"` or `"provider/model#variant"` | Omit to use the user's default. A string without `/` is silently ignored |
| `title` | string | Defaults to `Task <first 40 chars>`; set it so the user can find the session in OpenCode |

## Parallel work

Start several `opencode_task` calls first, then `opencode_wait` on each. Never point two writing tasks at overlapping files in the same `directory`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Reporting "done" after `opencode_task` | It only started. Wait for `succeeded` |
| Task says "fix the bug we discussed" | Worker has no context. Spell it out |
| Editing a real repo without `directory` | Work landed in the sandbox `workdir/`. Re-run with the absolute path |
| Treating `timeout` as failure | Call `opencode_wait` again |
| Cancelling a session stuck on `pendingPermission` | Ask the user to approve it in OpenCode |
| New task for each refinement | `opencode_respond` keeps context and is cheaper |
| Trusting `result` blindly | Inspect files / run tests yourself |
| Delegating a one-line edit | Do trivial work yourself; delegation costs a whole session |

## Errors

| Error | Fix |
|---|---|
| `OpenCode service not found and could not be started` | User needs the OpenCode CLI installed and `opencode auth login` once; or run `opencode serve` |
| Calls fail right after an OpenCode CLI upgrade | The bridge pins `@opencode/client` to the CLI version; bump it in the bridge repo, `npm run build` |
| Session not found | Wrong `sessionId`; list with `opencode_status` |
