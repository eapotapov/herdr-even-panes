// even-panes: keep the panes of a row or column equal.
//
// Herdr's own split hands the new pane half of the split pane (50/25/25
// after two splits), and a closed pane's share goes to its left neighbor.
// This mod evens the affected row or column out again, in two ways:
//
// - Automatically (props.auto, default true): whenever a pane appears or
//   disappears anywhere, the row or column that changed is evened out.
//   Dragging a divider changes no pane set, so manual sizes stay.
// - On command (bind as "even-panes.<command>" in keys.json):
//     split-right    split the focused pane to the right, then even out its row
//     split-down     split the focused pane downward, then even out its column
//     close          close the focused pane, then even out what is left
//     equalize       even out the focused pane's row or column
//     equalize-tab   even out every row and column of the focused tab
//
// The mod draws nothing. It sits in a floating slot of the layout only so
// that Herdr counts it as shown and delivers key commands to it.

import { View, div } from "gpui-kit";
import { run, focused, panes, home, readTextFile, notify, nextCommand, props } from "herdr";

// Spaces, tabs and splits live in herdr-core's document for the app. This is
// the default local core session; the app has no API for the tree itself.
const CORE_DOC = `${home()}/.local/state/herdr-core/default/docs.json`;
const WAIT_MS = 100;
const WAIT_TRIES = 30;

async function readTree() {
  const text = await readTextFile(CORE_DOC).catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text)["herdr-app"]?.value?.spaces ?? null;
  } catch {
    return null;
  }
}

function* nodes(spaces) {
  for (const space of spaces ?? []) {
    for (const tab of space.tabs ?? []) yield* walk(tab.root, tab.id);
  }
}

function* walk(node, tab) {
  if (!node) return;
  yield [node, tab];
  for (const child of node.children ?? []) yield* walk(child, tab);
}

const isContainer = (node) => node.type === "row" || node.type === "column";

/** Container id -> sorted child ids, for every row and column in the tree. */
function containers(spaces) {
  const out = new Map();
  for (const [node] of nodes(spaces)) {
    if (isContainer(node)) out.set(node.id, (node.children ?? []).map((c) => c.id).sort().join(" "));
  }
  return out;
}

function leafIds(spaces) {
  const ids = new Set();
  for (const [node] of nodes(spaces)) if (node.type === "block") ids.add(node.id);
  return ids;
}

/** Local panes on screen now, the set the core document should catch up to. */
function localPaneIds() {
  return new Set(panes().map((p) => p.pane).filter((id) => !id.includes("/")));
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function evenOut(container) {
  const kids = container.children ?? [];
  if (kids.length < 2) return;
  const share = 1 / kids.length;
  for (const child of kids) run("layout.resize", { id: child.id, weight: share });
}

export default class EvenPanes extends View {
  init(_props, cx) {
    this.known = null; // container id -> child ids, as of the last tree we acted on
    this.seen = localPaneIds();
    this.settling = false;
    cx.spawn(async (cx) => {
      this.known = containers(await readTree());
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try {
          await this.handle(command, cx);
        } catch (error) {
          notify({ title: "even-panes", body: String(error), level: "error" });
        }
      }
    });
  }

  auto() {
    return (props() ?? {}).auto !== false;
  }

  async handle(command, cx) {
    switch (command) {
      case "split-right":
        return this.splitAndEven("right", cx);
      case "split-down":
        return this.splitAndEven("down", cx);
      case "close":
        return this.closeAndEven(cx);
      case "equalize":
        return this.evenFocused(await this.tree());
      case "equalize-tab":
        return this.evenTab(await this.tree());
      default:
        notify({ title: "even-panes", body: `unknown command "${command}"`, level: "warning" });
    }
  }

  async tree() {
    const spaces = await readTree();
    if (!spaces) notify({ title: "even-panes", body: `cannot read ${CORE_DOC}`, level: "error" });
    return spaces;
  }

  /** The row or column holding `pane`, or null when it is alone in its tab. */
  parentOf(spaces, pane) {
    for (const [node] of nodes(spaces)) {
      if (isContainer(node) && (node.children ?? []).some((c) => c.id === pane)) return node;
    }
    return null;
  }

  evenFocused(spaces) {
    const pane = focused()?.pane;
    if (!pane || !spaces) return;
    const parent = this.parentOf(spaces, pane);
    if (parent) evenOut(parent);
    this.known = containers(spaces);
  }

  evenTab(spaces) {
    const tab = focused()?.tab;
    if (!tab || !spaces) return;
    for (const [node, owner] of nodes(spaces)) {
      if (owner === tab && isContainer(node)) evenOut(node);
    }
    this.known = containers(spaces);
  }

  async splitAndEven(direction, cx) {
    const pane = focused()?.pane;
    if (!pane) {
      notify({ title: "even-panes", body: "no focused pane to split", level: "warning" });
      return;
    }
    run("pane.split", { direction, pane });
    // The new pane is always a sibling of the split one, so once the
    // document shows the new pane, evening out the split pane's row or
    // column covers both the sibling and the wrapped case.
    const spaces = await this.settled(cx);
    if (!spaces) return;
    const parent = this.parentOf(spaces, pane);
    if (parent) evenOut(parent);
    this.known = containers(spaces);
  }

  async closeAndEven(cx) {
    const pane = focused()?.pane;
    if (!pane) return;
    const before = await readTree();
    const parent = before && this.parentOf(before, pane);
    run("pane.close", { pane });
    const spaces = await this.settled(cx);
    if (!spaces || !parent) return;
    // The container may have collapsed into its parent when one child was left.
    const still = [...nodes(spaces)].map(([n]) => n).find((n) => n.id === parent.id);
    if (still) evenOut(still);
    this.known = containers(spaces);
  }

  /** Waits until the core document lists exactly the panes on screen. */
  async settled(cx) {
    const want = localPaneIds();
    for (let i = 0; i < WAIT_TRIES; i++) {
      await cx.sleep(WAIT_MS);
      const spaces = await readTree();
      if (spaces && sameSet(leafIds(spaces), want)) return spaces;
    }
    notify({ title: "even-panes", body: "the layout did not update in time", level: "warning" });
    return null;
  }

  /** Auto mode: a pane came or went somewhere; even out the containers whose children changed. */
  rebalance(cx) {
    if (this.settling) return;
    this.settling = true;
    cx.spawn(async (cx) => {
      try {
        const spaces = await this.settled(cx);
        if (!spaces) return;
        const now = containers(spaces);
        if (this.known) {
          for (const [node] of nodes(spaces)) {
            if (isContainer(node) && this.known.get(node.id) !== now.get(node.id)) evenOut(node);
          }
        }
        this.known = now;
      } finally {
        this.settling = false;
        this.seen = localPaneIds();
      }
    });
  }

  render(cx) {
    // Herdr re-renders on every live change; a changed pane set means a split or a close.
    if (this.auto() && this.known && !this.settling) {
      const now = localPaneIds();
      if (!sameSet(now, this.seen)) {
        this.seen = now;
        this.rebalance(cx);
      }
    }
    // Nothing visible: a floating block sizes to its content, so this stays hidden.
    return div().id("root").size_0();
  }
}
