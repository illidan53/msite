import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefreshControls } from "./RefreshControls";

afterEach(() => {
  cleanup();
});

describe("RefreshControls", () => {
  it("renders compact refresh interval options in a dropdown", () => {
    render(
      <RefreshControls
        intervalSeconds={60}
        disabledIntervals={[10]}
        onChange={vi.fn()}
      />,
    );

    const select = screen.getByLabelText("Refresh interval");

    expect(select).toHaveValue("60");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "10s",
      "1m",
      "5m",
      "30m",
      "1h",
      "1d",
    ]);
    expect(screen.getByRole("option", { name: "10s" })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("calls onChange with seconds when the interval changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RefreshControls
        intervalSeconds={60}
        disabledIntervals={[]}
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Refresh interval"), "300");

    expect(onChange).toHaveBeenCalledWith(300);
  });
});
