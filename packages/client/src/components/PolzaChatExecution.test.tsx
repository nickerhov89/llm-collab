// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PolzaChatExecution } from "./PolzaChatExecution";

const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  command: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("../api/client", () => ({ fetchJSON: mock.fetch }));
vi.mock("../i18n", () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
vi.mock("./PolzaTaskAutomation", () => ({ PolzaTaskAutomation: () => null }));
vi.mock("./ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
let objective: string | null;
let status: string | null;
let supported: boolean;
function mount() {
  return render(
    <PolzaChatExecution
      projectId="project"
      sessionId="session"
      running={false}
      onGoalCommand={mock.command}
      onActivateGoal={mock.activate}
      onClose={() => {}}
    />,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  objective = null;
  status = null;
  supported = true;
  mock.fetch.mockImplementation(async (path: string) =>
    path.includes("/metadata")
      ? {
          slashCommands: supported
            ? [
                {
                  name: "goal",
                  providerDetails: {
                    codex: { goalObjective: objective, goalStatus: status },
                  },
                },
              ]
            : [],
        }
      : { job: null },
  );
});
afterEach(cleanup);
async function goalMode() {
  const select = screen.getByRole("combobox", { name: "chatExecutionTitle" });
  await waitFor(() =>
    expect((select as HTMLSelectElement).disabled).toBe(false),
  );
  fireEvent.change(select, { target: { value: "goal" } });
}
it("starts only the native goal command, accepting a goal that completes before confirmation", async () => {
  mock.command.mockImplementation(async (text: string) => {
    objective = text.slice(6);
    status = "complete";
  });
  mount();
  await goalMode();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "A verifiable result" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "chatExecutionStartGoal" }),
  );
  await screen.findByText("chatExecutionGoalComplete");
  expect(mock.command.mock.calls).toEqual([["/goal A verifiable result"]]);
  expect(
    mock.fetch.mock.calls.some(([, init]) =>
      init?.body?.includes('"operation":"run"'),
    ),
  ).toBe(false);
});
it("retains the objective draft and never reports success when the native command is refused", async () => {
  mock.command.mockRejectedValue(Error("Native command refused"));
  mount();
  await goalMode();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "chatExecutionStartGoal" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Native command refused");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Keep this draft",
  );
  expect(screen.queryByText("chatExecutionGoalStarted")).toBeNull();
});
it("activates a cold chat without sending a work turn", async () => {
  supported = false;
  mock.activate.mockImplementation(async () => {
    supported = true;
  });
  mount();
  await goalMode();
  fireEvent.click(
    screen.getByRole("button", { name: "chatExecutionActivate" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("chatExecutionGoalUnavailable")).toBeNull(),
  );
  expect(mock.activate).toHaveBeenCalledOnce();
  expect(mock.command).not.toHaveBeenCalled();
});
