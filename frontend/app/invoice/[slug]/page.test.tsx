import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import InvoiceLinkLandingPage from "./page";

const mockOpenModal = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "abc123" }),
}));

vi.mock("@/lib/wallet-context", () => ({
  useWallet: () => ({ openModal: mockOpenModal, isConnected: false }),
}));

// QR rendering relies on canvas APIs jsdom doesn't implement; stub it out so
// these tests focus on the page's data/loading/error states.
vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

const INVOICE = {
  id: "inv_1",
  slug: "abc123",
  sender: "GSENDERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  receiver: "GRECEIVERADDRESSBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  amount: "500",
  tokenAddress: "USDC",
  duration: 3600,
  description: "Consulting invoice",
  status: "DRAFT" as const,
  expiresAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  shareUrl: "https://stellarstream.app/invoice/abc123",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InvoiceLinkLandingPage", () => {
  it("shows a loading state before the fetch resolves", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InvoiceLinkLandingPage />);
    expect(screen.getByText(/loading payment request/i)).toBeInTheDocument();
  });

  it("renders payment details once the invoice loads", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(INVOICE),
    });

    render(<InvoiceLinkLandingPage />);

    await waitFor(() => {
      expect(screen.getByText("500 USDC")).toBeInTheDocument();
    });
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    expect(screen.getByText("Consulting invoice")).toBeInTheDocument();
  });

  it("fetches the invoice by the slug from the route params", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(INVOICE),
    });

    render(<InvoiceLinkLandingPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/invoice-links/abc123");
    });
  });

  it("shows an error state when the invoice link is missing or expired", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Invoice link not found or expired" }),
    });

    render(<InvoiceLinkLandingPage />);

    await waitFor(() => {
      expect(screen.getByText("Invoice link not found or expired")).toBeInTheDocument();
    });
  });

  it("opens the wallet modal when the pay button is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(INVOICE),
    });

    render(<InvoiceLinkLandingPage />);

    const payButton = await screen.findByText(/connect wallet to pay/i);
    payButton.click();
    expect(mockOpenModal).toHaveBeenCalled();
  });
});
