import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecommendationCandidate } from "../../../shared/types";
import { WatchlistEditor } from "./WatchlistEditor";

afterEach(() => {
  cleanup();
});

describe("WatchlistEditor", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <WatchlistEditor open={false} onClose={vi.fn()} onSave={vi.fn()} recommend={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog", { name: "Watchlist editor" })).not.toBeInTheDocument();
  });

  it("requests recommendations and saves the selected candidates", async () => {
    const user = userEvent.setup();
    const recommend = vi.fn(async () => recommendationCandidates);
    const onSave = vi.fn();

    render(<WatchlistEditor open onClose={vi.fn()} onSave={onSave} recommend={recommend} />);

    await user.type(screen.getByLabelText("Name"), "AI Leaders");
    await user.type(screen.getByLabelText("Theme"), "AI chips");
    await user.type(screen.getByLabelText("Pinned symbols"), " nvda, amd, nvda ");
    await user.click(screen.getByRole("button", { name: "Recommend" }));

    expect(recommend).toHaveBeenCalledWith({
      excludedSymbols: [],
      limit: 8,
      pinnedSymbols: ["NVDA", "AMD"],
      theme: "AI chips",
    });

    await user.click(await screen.findByRole("checkbox", { name: /TSM/i }));
    await user.click(screen.getByRole("checkbox", { name: /ASML/i }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      id: "ai-leaders",
      name: "AI Leaders",
      theme: "AI chips",
      pinnedSymbols: ["NVDA", "AMD"],
      rows: [
        {
          id: "recommended",
          name: "Recommended",
          expandedByDefault: true,
          symbols: ["NVDA", "AMD", "TSM", "ASML"],
        },
      ],
    });
  });

  it("selects pinned recommendation candidates by default", async () => {
    const user = userEvent.setup();

    render(
      <WatchlistEditor
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        recommend={vi.fn(async () => recommendationCandidates)}
      />,
    );

    await user.type(screen.getByLabelText("Theme"), "AI chips");
    await user.type(screen.getByLabelText("Pinned symbols"), "NVDA");
    await user.click(screen.getByRole("button", { name: "Recommend" }));

    expect(await screen.findByRole("checkbox", { name: /NVDA/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /TSM/i })).not.toBeChecked();
  });

  it("shows an alert when recommendations fail", async () => {
    const user = userEvent.setup();

    render(
      <WatchlistEditor
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        recommend={vi.fn(async () => {
          throw new Error("Recommendation service unavailable");
        })}
      />,
    );

    await user.type(screen.getByLabelText("Theme"), "AI chips");
    await user.click(screen.getByRole("button", { name: "Recommend" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Recommendation service unavailable");
  });

  it("shows an alert and re-enables Save when saving fails", async () => {
    const user = userEvent.setup();
    const saveResult = createDeferred<void>();
    const onSave = vi.fn(() => saveResult.promise);

    render(<WatchlistEditor open onClose={vi.fn()} onSave={onSave} recommend={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Compounders");
    await user.type(screen.getByLabelText("Pinned symbols"), "cost");

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);

    expect(saveButton).toBeDisabled();

    saveResult.reject(new Error("Save failed"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(saveButton).toBeEnabled();
  });

  it("keeps Save disabled until a name and at least one symbol are present", async () => {
    const user = userEvent.setup();

    render(<WatchlistEditor open onClose={vi.fn()} onSave={vi.fn()} recommend={vi.fn()} />);

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "Compounders");
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByLabelText("Pinned symbols"), "cost");
    expect(saveButton).toBeEnabled();
  });

  it("keeps Recommend disabled until the theme contains text", async () => {
    const user = userEvent.setup();
    const recommend = vi.fn(async () => recommendationCandidates);

    render(<WatchlistEditor open onClose={vi.fn()} onSave={vi.fn()} recommend={recommend} />);

    const recommendButton = screen.getByRole("button", { name: "Recommend" });
    const themeInput = screen.getByLabelText("Theme");

    expect(recommendButton).toBeDisabled();

    await user.type(themeInput, "   ");
    expect(recommendButton).toBeDisabled();

    await user.click(recommendButton);
    expect(recommend).not.toHaveBeenCalled();

    await user.clear(themeInput);
    await user.type(themeInput, "AI chips");

    expect(recommendButton).toBeEnabled();
  });

  it("calls onClose from the Close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<WatchlistEditor open onClose={onClose} onSave={vi.fn()} recommend={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the first field on open, closes on Escape, and restores focus after close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(
      <>
        <button type="button">Before editor</button>
        <WatchlistEditor open={false} onClose={onClose} onSave={vi.fn()} recommend={vi.fn()} />
      </>,
    );
    const beforeButton = screen.getByRole("button", { name: "Before editor" });
    beforeButton.focus();

    rerender(
      <>
        <button type="button">Before editor</button>
        <WatchlistEditor open onClose={onClose} onSave={vi.fn()} recommend={vi.fn()} />
      </>,
    );

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "Watchlist editor" })).not.toHaveAttribute("aria-modal");

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <button type="button">Before editor</button>
        <WatchlistEditor open={false} onClose={onClose} onSave={vi.fn()} recommend={vi.fn()} />
      </>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Before editor" })).toHaveFocus());
  });

  it("clears transient editor state after closing and reopening", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {
      throw new Error("Save failed");
    });
    const { rerender } = render(
      <WatchlistEditor
        open
        onClose={vi.fn()}
        onSave={onSave}
        recommend={vi.fn(async () => recommendationCandidates)}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "AI Leaders");
    await user.type(screen.getByLabelText("Theme"), "AI chips");
    await user.type(screen.getByLabelText("Pinned symbols"), "NVDA");
    await user.click(screen.getByRole("button", { name: "Recommend" }));
    expect(await screen.findByRole("checkbox", { name: /NVDA/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");

    rerender(
      <WatchlistEditor
        open={false}
        onClose={vi.fn()}
        onSave={onSave}
        recommend={vi.fn(async () => recommendationCandidates)}
      />,
    );
    rerender(
      <WatchlistEditor
        open
        onClose={vi.fn()}
        onSave={onSave}
        recommend={vi.fn(async () => recommendationCandidates)}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Theme")).toHaveValue("");
    expect(screen.getByLabelText("Pinned symbols")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /NVDA/i })).not.toBeInTheDocument();
  });

  it("ignores recommendation results that resolve after the editor closes", async () => {
    const user = userEvent.setup();
    const recommendResult = createDeferred<RecommendationCandidate[]>();
    const recommend = vi.fn(() => recommendResult.promise);
    const { rerender } = render(<WatchlistEditor open onClose={vi.fn()} onSave={vi.fn()} recommend={recommend} />);

    await user.type(screen.getByLabelText("Theme"), "AI chips");
    await user.click(screen.getByRole("button", { name: "Recommend" }));

    rerender(<WatchlistEditor open={false} onClose={vi.fn()} onSave={vi.fn()} recommend={recommend} />);

    await act(async () => {
      recommendResult.resolve(recommendationCandidates);
      await recommendResult.promise;
    });

    rerender(<WatchlistEditor open onClose={vi.fn()} onSave={vi.fn()} recommend={recommend} />);

    expect(screen.queryByRole("checkbox", { name: /NVDA/i })).not.toBeInTheDocument();
  });
});

const recommendationCandidates: RecommendationCandidate[] = [
  {
    symbol: "NVDA",
    name: "Nvidia",
    source: "pinned",
    score: 100,
    reasons: ["user pinned"],
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    source: "pinned",
    score: 90,
    reasons: ["user pinned"],
  },
  {
    symbol: "TSM",
    name: "Taiwan Semiconductor",
    source: "related",
    score: 80,
    reasons: ["related candidate"],
  },
  {
    symbol: "ASML",
    name: "ASML Holding",
    source: "reference",
    score: 70,
    reasons: ["reference candidate"],
  },
];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}
