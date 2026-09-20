import { useCallback, useEffect, useReducer, useRef } from "react";
import { initialState, reducer } from "./store";
import { isWorking } from "./types";
import type { Agent, AgentState, Entry, Notification, Thread } from "./types";
export function useWorkspace() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const latest = useRef(state);
  latest.current = state;
  const timers = useRef(new Map<string, Set<ReturnType<typeof setTimeout>>>());
  const locked = useRef(new Set<string>());
  useEffect(
    () => () => {
      timers.current.forEach((set) => set.forEach(clearTimeout));
    },
    [],
  );
  const cancel = useCallback((id: string) => {
    timers.current.get(id)?.forEach(clearTimeout);
    timers.current.delete(id);
  }, []);
  const later = useCallback((t: Thread, ms: number, fn: () => void) => {
    const set = timers.current.get(t.id) || new Set();
    timers.current.set(t.id, set);
    const timer = setTimeout(() => {
      set.delete(timer);
      if (latest.current.threads.find((x) => x.id === t.id)?.run === t.run)
        fn();
    }, ms);
    set.add(timer);
  }, []);
  const setState = useCallback(
    (t: Thread, value: AgentState, phase?: string) =>
      dispatch({
        type: "state",
        id: t.id,
        state: value,
        phase,
        now: performance.now(),
        time: Date.now(),
        run: t.run,
      }),
    [],
  );
  const entry = useCallback(
    (t: Thread, kind: Entry["kind"], text = "", actor?: Agent) =>
      dispatch({
        type: "entry",
        id: t.id,
        entry: { id: crypto.randomUUID(), kind, text, actor },
        run: t.run,
      }),
    [],
  );
  const continueWork = useCallback(
    (t: Thread) => {
      setState(t, "working", "Reading and grouping sources");
      entry(t, "event", "Control returned to " + t.name);
      later(t, 1400, () =>
        setState(t, "working", "Combining notes from Project guide"),
      );
      later(t, 2600, () => {
        entry(t, "event", "Context contributed by Project guide");
        entry(
          t,
          "message",
          "The project notes suggest starting with one clearly defined workflow. I have included that context in the draft.",
        );
        setState(t, "working", "Preparing recommendations");
      });
      later(t, 3900, () => {
        setState(t, "review_ready");
        entry(t, "review");
        entry(
          t,
          "message",
          "The draft is ready. Review the three recommendations before approving this demonstration.",
        );
      });
    },
    [setState, entry, later],
  );
  const start = useCallback(
    (
      t: Thread,
      text = "Prepare a concise landscape brief. Compare the sources, identify the strongest patterns, and leave recommendations ready for review.",
    ) => {
      if (
        isWorking(t.state) ||
        t.state === "action_needed" ||
        t.state === "human_control" ||
        t.state === "review_ready"
      )
        return;
      entry(t, "user", text);
      if (!t.memberIds) {
        setState(t, "thinking", "Checking the example source collection");
        later(t, 1100, () => {
          entry(
            t,
            "message",
            "I have a plan for the brief. First, I need access to the example source collection.",
          );
          setState(t, "action_needed");
          entry(t, "tool");
        });
        return;
      }
      const people = t.memberIds
        .map((id) => latest.current.agents.find((a) => a.id === id)!)
        .filter(Boolean);
      const mentioned = people.filter((a) => text.includes("@" + a.name));
      const ordered = [
        ...mentioned,
        ...people.filter((a) => !mentioned.includes(a)),
      ];
      setState(t, "working", "The group is collaborating");
      dispatch({
        type: "typing",
        id: t.id,
        ids: people.map((a) => a.id),
        run: t.run,
      });
      ordered.forEach((a, i) => {
        const next = ordered[(i + 1) % ordered.length];
        later(t, 650 + i * 550, () => {
          entry(
            t,
            "message",
            `@${next.name} I’m taking the ${a.role.toLowerCase()} part of this task. I’ll share my findings here so we can compare approaches.`,
            a,
          );
          dispatch({
            type: "typing",
            id: t.id,
            ids: ordered.slice(i + 1).map((a) => a.id),
            run: t.run,
          });
        });
        later(t, 1700 + i * 650, () =>
          dispatch({
            type: "typing",
            id: t.id,
            ids: ordered.slice(i).map((a) => a.id),
            run: t.run,
          }),
        );
        later(t, 2600 + i * 650, () =>
          entry(
            t,
            "message",
            `@${next.name} My first recommendation is to define the outcome, identify the evidence we need, and keep a review step before execution. How does that fit with your part?`,
            a,
          ),
        );
      });
      later(t, 3300 + people.length * 650, () => {
        entry(
          t,
          "message",
          "We have a shared direction: scope the task, combine our specialist findings, and present a draft for your review. These messages demonstrate the group flow; no external work was executed.",
          ordered[0],
        );
        setState(t, "completed");
        entry(
          t,
          "event",
          "Collaboration demo complete · " +
            people.length +
            " agents contributed",
        );
      });
    },
    [entry, setState, later],
  );
  const approve = useCallback(
    (t: Thread) => {
      entry(t, "user", "I approve demo brief version 1.");
      setState(t, "completed");
      entry(t, "event", "Approval recorded for draft v1 · no external action");
      entry(
        t,
        "message",
        "Demo complete. Version 1 is approved in this local session. No brief was sent or published.",
      );
    },
    [entry, setState],
  );
  const decide = useCallback(
    (n: Notification, decision: "Accepted" | "Declined") => {
      const current = latest.current.notifications.find((x) => x.id === n.id),
        t = latest.current.threads.find((t) => t.id === n.threadId);
      if (!current || current.resolved || !t || locked.current.has(n.id))
        return;
      if (n.runId && n.runId !== t.runId) {
        dispatch({
          type: "notification",
          id: n.id,
          patch: { resolved: "No longer pending", unread: false },
        });
        return;
      }
      locked.current.add(n.id);
      if (n.expectedState && n.expectedState !== t.state) {
        dispatch({
          type: "notification",
          id: n.id,
          patch: { resolved: "No longer pending", unread: false },
        });
        return;
      }
      dispatch({ type: "resolve", id: n.id, decision });
      if (decision === "Declined") {
        if (n.request !== "proposal") {
          cancel(t.id);
          setState(t, "completed", "Task declined");
        }
        entry(t, "event", "You declined: " + n.body);
      } else if (n.request === "access") continueWork(t);
      else if (n.request === "review") approve(t);
      else {
        dispatch({ type: "select", id: t.id });
        start(t, "Help me plan the next steps for this task.");
      }
    },
    [cancel, setState, entry, continueWork, approve, start],
  );
  const reset = useCallback(
    (id: string) => {
      cancel(id);
      dispatch({ type: "reset", id });
    },
    [cancel],
  );
  const cancelRun = useCallback(
    (id: string) => {
      cancel(id);
      dispatch({ type: "cancel", id });
    },
    [cancel],
  );
  const send = useCallback(
    (t: Thread, text: string) => {
      if (t.state === "idle" || (t.memberIds && t.state === "completed"))
        start(t, text);
      else {
        entry(t, "user", text);
        if (t.memberIds)
          entry(
            t,
            "message",
            "Your additional note is in our shared work log. We’ll keep it alongside this ongoing demo.",
            latest.current.agents.find((a) => a.id === t.memberIds![0]),
          );
        else
          entry(
            t,
            "message",
            "Your note is recorded here. Continue the current task or reset this thread to begin another run.",
          );
      }
    },
    [start, entry],
  );
  return {
    state,
    dispatch,
    start,
    send,
    reset,
    cancelRun,
    setState,
    entry,
    continueWork,
    approve,
    decide,
  };
}
