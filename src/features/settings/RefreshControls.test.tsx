import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefreshControls } from "./RefreshControls";

afterEach(() => {
  cleanup();
});

describe("RefreshControls", () => {
  it("disables blocked intervals and labels warning state", () => {
    render(
      <RefreshControls
        intervalSeconds={30}
        disabledIntervals={[5, 10]}
        status="warning"
        message="Stocks Starter has unlimited REST calls, but this interval is aggressive."
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "5s" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "10s" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "30s" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveClass("warning");
    expect(screen.getByRole("status")).toHaveTextContent("aggressive");
  });

  it("calls onChange with seconds when an enabled interval is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RefreshControls
        intervalSeconds={30}
        disabledIntervals={[5]}
        status="ok"
        message="Refresh interval is within budget."
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "1m" }));

    expect(onChange).toHaveBeenCalledWith(60);
  });
});
