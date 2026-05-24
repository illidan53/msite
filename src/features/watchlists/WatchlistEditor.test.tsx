import { cleanup, render, screen } from "@testing-library/react";
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

  it("calls onClose from the Close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<WatchlistEditor open onClose={onClose} onSave={vi.fn()} recommend={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
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
