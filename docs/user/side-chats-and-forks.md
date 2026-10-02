# Side chats and forks

Side chats and forks both branch an existing conversation with its context intact. They differ in
where the new conversation appears:

- **Open side chat** opens the branch beside the current thread on web and desktop. On mobile, it
  opens as a full-screen conversation. A side chat stays out of the main thread list for as long as
  its parent thread exists.
- **Fork to new thread** creates a normal thread and opens it as the main conversation.

Use the fork action on a completed agent response to choose the exact point where the new
conversation begins. You can also open a side chat or create a fork from the thread menu or command
palette. Both capture the conversation's current progress, including a running turn, when the
provider supports it. The original conversation keeps running. **Open side chat** defaults to
`mod+shift+b`. On web and desktop, **Side chat** is also available in **Open a surface** and the
panel tab bar’s **+** menu. Type `/side ` in the composer to choose **Open Side**, then write
a message and send it to open a side chat and run the message there. Sending `/side` alone opens
an empty side chat. Its context is captured when it opens, so later progress in the original
conversation does not change it. If the conversation cannot be forked yet, sending the command
explains why.
**Fork to new thread** has no default shortcut, but you can assign one in
**Settings → Keybindings**.

## Provider support

Forking follows the active provider's session capabilities:

- Codex, Claude, and OpenCode can fork their current progress without finishing a turn.
- Codex also supports choosing any completed agent response as the fork point.
- Claude and OpenCode support choosing only the latest completed agent response.
- Cursor, Grok, and Antigravity do not support session forking.

Start the original conversation before creating a side chat or fork. Unsupported providers keep
the thread-menu and command-palette actions visible but unavailable. Connections to older servers
use completed responses as fork points. T3 Code hides the fork action on earlier responses when
the provider can fork only from the latest turn.

## Managing side chats

Closing a side-chat tab settles its thread. The conversation still exists, and you can reopen it
from **Side chats** in its parent thread's menu. Send a message to make it active again. If the
thread cannot be settled yet, the tab stays open and explains why. On mobile, the same menu opens
each side chat as a full-screen thread.

Choose **Promote to thread** to move a side chat into the main thread list. It keeps its
conversation and its link back to the parent.

Deleting a side chat uses the normal thread delete action and permanently clears its conversation
history. Closing and deleting are separate actions.

Deleting a parent thread leaves its side chats intact. Without a parent, they return to the thread
list as ordinary threads.

Forked threads and promoted side chats show **Forked from _parent title_** at the top of the
conversation. Select it to return to the source thread. If the source thread was deleted, web and
desktop show **Forked from a deleted thread** instead, and mobile hides the label.
