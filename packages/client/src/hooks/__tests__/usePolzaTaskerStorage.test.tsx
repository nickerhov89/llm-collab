import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchJSON } from "../../api/client";
import { usePolzaTaskerStorage } from "../usePolzaTaskerStorage";
vi.mock("../../api/client", () => ({ fetchJSON: vi.fn() }));
const fetcher = vi.mocked(fetchJSON);
const empty = { version: 1, tasks: [] as { id: string; title: string }[] };
const first = { version: 1, tasks: [{ id: "one", title: "A" }] };
const second = { version: 1, tasks: [{ id: "one", title: "AB" }] };
const state = (data = empty, revision = 0) => ({
  accountKey: "owner",
  revision,
  data,
});
const parse = (raw: string) => JSON.parse(raw);
beforeEach(() => {
  localStorage.clear();
  fetcher.mockReset();
});
afterEach(cleanup);
it("serializes edits while a save is pending and preserves the latest text", async () => {
  let resolve!: (v: unknown) => void;
  fetcher
    .mockResolvedValueOnce(state())
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(state(second, 2));
  const { result } = renderHook(() =>
    usePolzaTaskerStorage("test", parse, empty),
  );
  await waitFor(() => expect(result.current.phase).toBe("saved"));
  act(() => {
    result.current.persist(first);
    result.current.persist(second);
  });
  expect(result.current.data).toEqual(second);
  await act(async () => resolve(state(first, 1)));
  await waitFor(() => expect(result.current.phase).toBe("saved"));
  expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string)).toMatchObject({
    revision: 1,
    data: second,
  });
  expect(localStorage.getItem("test:server-draft")).toBeNull();
});
it("ignores a late focus response after immediate note typing", async () => {
  let resolve!: (v: unknown) => void;
  fetcher.mockResolvedValueOnce(state(first)).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { result } = renderHook(() =>
    usePolzaTaskerStorage("test", parse, empty),
  );
  await waitFor(() => expect(result.current.phase).toBe("saved"));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(result.current.loadError).toBe(false);
  act(() => result.current.setData(second));
  await act(async () => resolve(state(first)));
  expect(result.current.data).toEqual(second);
  expect(JSON.parse(localStorage.getItem("test:server-draft")!).data).toEqual(
    second,
  );
});
it("retains a failed draft and never silently overwrites a newer server copy", async () => {
  fetcher
    .mockResolvedValueOnce(state())
    .mockRejectedValueOnce(new Error("409"));
  const { result } = renderHook(() =>
    usePolzaTaskerStorage("test", parse, empty),
  );
  await waitFor(() => expect(result.current.phase).toBe("saved"));
  act(() => {
    result.current.persist(second);
  });
  await waitFor(() => expect(result.current.problem).toBe("save"));
  expect(result.current.data).toEqual(second);
  expect(result.current.persist(first)).toBe(false);
  expect(JSON.parse(localStorage.getItem("test:server-draft")!).data).toEqual(
    second,
  );
});
it("imports only absent legacy ids and preserves server tombstones", async () => {
  localStorage.setItem(
    "test",
    JSON.stringify({
      version: 1,
      tasks: [
        { id: "one", title: "Old" },
        { id: "two", title: "Import" },
      ],
    }),
  );
  const remote = {
    version: 1,
    tasks: [{ id: "one", title: "Deleted", deleted: true }],
  };
  fetcher
    .mockResolvedValueOnce(state(remote))
    .mockImplementationOnce(async (_path, options) => ({
      ...JSON.parse(options!.body as string),
      revision: 1,
    }));
  const { result } = renderHook(() =>
    usePolzaTaskerStorage("test", parse, empty),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(result.current.data.tasks).toEqual([
    ...remote.tasks,
    { id: "two", title: "Import" },
  ]);
});
