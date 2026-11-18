import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

export function useTaskerReordering(
  view: string,
  ids: string[],
  enabled: boolean,
  move: (from: string, to: string) => void,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<{
    id: string;
    y: number;
    moved: boolean;
    target: string;
  } | null>(null);
  const current = useRef({ ids, enabled, move });
  current.current = { ids, enabled, move };
  useEffect(() => {
    void view;
    if (!enabled || drag.current) {
      drag.current = null;
      setDragging(null);
      setOver(null);
    }
  }, [view, enabled]);
  const clear = () => {
    drag.current = null;
    setDragging(null);
    setOver(null);
  };
  return {
    dragging,
    over,
    handle: (id: string) => ({
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (!current.current.enabled || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id, y: event.clientY, moved: false, target: id };
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const active = drag.current;
        if (!active || active.id !== id) return;
        if (!active.moved && Math.abs(event.clientY - active.y) < 5) return;
        if (!active.moved) {
          active.moved = true;
          setDragging(id);
        }
        const list =
          event.currentTarget.closest<HTMLElement>("[data-tasker-list]");
        const row = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-tasker-row]");
        const target = row?.dataset.taskerRow;
        if (
          target &&
          list?.contains(row) &&
          current.current.ids.includes(target)
        ) {
          active.target = target;
          setOver((previous) => (previous === target ? previous : target));
        }
        if (list) {
          const bounds = list.getBoundingClientRect();
          if (event.clientY < bounds.top + 40) list.scrollBy(0, -16);
          else if (event.clientY > bounds.bottom - 40) list.scrollBy(0, 16);
        }
      },
      onPointerUp() {
        const active = drag.current;
        if (active?.id === id && active.moved && current.current.enabled)
          current.current.move(id, active.target);
        clear();
      },
      onPointerCancel: clear,
      onLostPointerCapture: clear,
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key === "Escape") {
          clear();
          return;
        }
        if (
          !current.current.enabled ||
          !["ArrowUp", "ArrowDown"].includes(event.key)
        )
          return;
        event.preventDefault();
        const position = current.current.ids.indexOf(id);
        const target =
          current.current.ids[position + (event.key === "ArrowUp" ? -1 : 1)];
        if (position >= 0 && target) current.current.move(id, target);
      },
    }),
  };
}
