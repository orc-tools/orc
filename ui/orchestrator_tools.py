"""Orc orchestration tool schemas and contracts."""


def object_schema(properties=None, required=()):
    return {"type": "object", "properties": properties or {},
            "required": list(required), "additionalProperties": False}


def string_schema(description="", values=None):
    value = {"type": "string", "minLength": 1}
    if description:
        value["description"] = description
    if values:
        value["enum"] = list(values)
    return value


RUN_ID = string_schema("Run ID returned by delegation or thread listing.")
TASK_ID = string_schema("Task ID returned by delegate_task.")
TIMEOUT = {"type": "number", "minimum": 0}
TARGET = object_schema({
    "providerInstanceId": string_schema("Provider instance ID advertised by orchestrator_capabilities."),
    "model": string_schema(),
    "options": object_schema({"effort": string_schema(), "fast": {"type": "boolean"}}),
}, ("providerInstanceId",))


# A coordinator picks a task's role from these words alone, so each says what
# work the role takes and what orchestration.py lets its worker write.
ROLES = {
    "implementation": "writes the code for work whose design is settled, in the files you declare",
    "research": "reads code, docs or history and reports back; read-only",
    "review": "checks a change and reports findings without editing it; read-only",
    "design": ("works out how something should look or fit together, such as a UI layout, visual "
               "variants, mockups or an architecture. Declare files for mockups or variants it "
               "should commit; with none it is read-only and returns a written proposal"),
    "test": "writes and runs checks, in the files you declare",
    "general": "takes any task the other roles do not cover, in the files you declare",
}
ROLE_GUIDE = ("The kind of work this task is. It decides whether the child may write and, for a "
              "routed role, which model runs it. "
              + " ".join("%s: %s." % item for item in ROLES.items()))


def tool(name, description, properties=None, required=(), readonly=False):
    return {"name": name, "description": description,
            "inputSchema": object_schema(properties, required),
            "annotations": {"readOnlyHint": readonly, "destructiveHint": not readonly,
                            "openWorldHint": False}}


TOOLS = [
    tool("orchestrator_capabilities",
         "List the coordinator's own provider instance, its models, model options, inherited runtime "
         "settings, orchestration capabilities, `roles`: the task roles and the work each is for, and "
         "`routes`: the roles the user's Orchestrate rules send to a set provider and model. Choose "
         "delegate_task roles and targets from this catalog.", readonly=True),
    tool("delegate_task",
         "Delegate a self-contained task to an Orc-owned child of this run without copying parent "
         "conversation history. A role listed under routes in orchestrator_capabilities runs on its "
         "route's provider and model whatever target says, at an effort held inside the route's "
         "range and in Fast mode only when the route says so. For any other role, choose model/options from orchestrator_capabilities; the child "
         "runs on the coordinator's provider, omitted model/effort use Opus 5.5 or Sol 6.2 at medium, "
         "and explicit choices win. Permissions and Fast inherit. State the child's file "
         "ownership and deliverable in the task. Shared isolation uses the parent checkout; worktree isolation starts "
         "from its current commit and does not copy uncommitted changes. Prefer async for independent "
         "work. Child completion automatically notifies the parent, so continue useful work or end "
         "the turn instead of polling. Wait timeout is a parent wait budget and does not cancel the "
         "child. Keep the returned taskId after waitTimedOut. Delegate at most one review task per run; "
         "fix its findings yourself rather than starting another review round. Use a distinct "
         "clientRequestId per task, stable across retries. Runtime permissions inherit; request "
         "only modes advertised by the selected provider.",
         {"task": string_schema("Complete brief, ownership, constraints and expected result."),
          "target": TARGET,
          "role": string_schema(ROLE_GUIDE, values=tuple(ROLES)),
          "files": {"type": "array", "items": string_schema("Relative file owned by this child.")},
          "isolation": string_schema(values=("shared", "worktree")),
          "mode": string_schema(values=("async", "wait")), "timeoutMs": TIMEOUT,
          "clientRequestId": string_schema(),
          "title": string_schema("Short topic-specific title for the child run, at most 60 characters. "
                                 "Describe the work, for example Compare OSRS item data sources."),
          "runtimeMode": string_schema(values=("inherit", "default", "auto", "bypassPermissions", "danger-full-access"))},
         ("task", "role")),
    tool("task_status",
         "Read a delegated task belonging to this parent. A completed turn with live nested tasks "
         "is not task completion. The final summary remains stable after publication. Reading a "
         "terminal result acknowledges its automatic parent delivery. Use only when the result "
         "is needed during this turn; async completion already wakes the parent.",
         {"taskId": TASK_ID}, ("taskId",), readonly=True),
    tool("task_cancel",
         "Stop a delegated task and its descendant work, interrupt its active turn, and dispose "
         "automatic parent delivery. Published results remain readable; a terminal task keeps "
         "its existing status.",
         {"taskId": TASK_ID, "reason": string_schema(), "clientRequestId": string_schema()}, ("taskId",)),
    tool("task_complete",
         "Child runs only: publish your final summary and completed or failed status after your "
         "assigned work is finished. Include actual checks and commit head when available. "
         "This wakes the parent automatically; do not report completion while children still work.",
         {"summary": string_schema(), "status": string_schema(values=("completed", "failed")),
          "checks": {"type": "array", "items": object_schema({
              "command": string_schema(), "exitCode": {"type": "integer"},
              "result": string_schema()}, ("command", "exitCode", "result"))},
          "head": string_schema()}, ("summary", "status")),
    tool("orc_thread_list",
         "List runs accessible to this caller, with durable statuses "
         "and IDs usable by the Orc thread tools.", readonly=True),
    tool("orc_thread_read",
         "Read an accessible run's conversation and task results. "
         "Use the returned cursor for further pages.",
         {"runId": RUN_ID, "cursor": string_schema()}, ("runId",), readonly=True),
    tool("orc_thread_send",
         "Send a follow-up to an accessible run. It is delivered "
         "at once, stopping the run's active turn when its agent cannot take input mid-turn. "
         "Reuse clientRequestId on retries. Start the one delegated review task with delegate_task.",
         {"runId": RUN_ID, "text": string_schema(), "clientRequestId": string_schema()},
         ("runId", "text", "clientRequestId")),
    tool("orc_thread_wait",
         "Wait for an accessible run to settle. Timeout does not "
         "interrupt work. Reports status and does not acknowledge a delegated result.",
         {"runId": RUN_ID, "timeoutMs": TIMEOUT}, ("runId",), readonly=True),
    tool("orc_thread_interrupt",
         "Interrupt an accessible run's active turn. "
         "Use task_cancel to stop a delegated task and all its descendants.",
         {"runId": RUN_ID}, ("runId",)),
]
TOOLS_BY_NAME = {item["name"]: item for item in TOOLS}
