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
        intervalSeconds={3_600}
        disabledIntervals={[3_600, 10_800]}
        status="warning"
        message="Stocks Starter has unlimited REST calls, but this interval is aggressive."
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "1h" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3h" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5y" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("warning");
    expect(screen.getByRole("status")).toHaveTextContent("aggressive");
  });

  it("calls onChange with seconds when an enabled interval is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RefreshControls
        intervalSeconds={3_600}
        disabledIntervals={[3_600]}
        status="ok"
        message="Refresh interval is within budget."
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "3h" }));

    expect(onChange).toHaveBeenCalledWith(10_800);
  });
});
