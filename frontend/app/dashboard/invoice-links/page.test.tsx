import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import InvoiceLinksPage from "./page";

// QR rendering relies on canvas APIs jsdom doesn't implement; stub it out so
// these tests focus on the toggle behavior, not the canvas draw itself.
vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

const INVOICES = [
  {
    id: "inv_1",
    slug: "abc123",
    sender: "GSENDER",
    receiver: "GRECEIVER",
    amount: "500",
    tokenAddress: "USDC",
    duration: 3600,
    xdrParams: "",
    status: "DRAFT",
    viewCount: 3,
    lastViewedAt: "2026-07-10T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    shareUrl: "https://stellarstream.app/invoice/abc123",
    description: undefined,
    customMessage: undefined,
    pdfUrl: undefined,
  },
  {
    id: "inv_2",
    slug: "def456",
    sender: "GSENDER",
    receiver: "GREC2",
    amount: "250",
    tokenAddress: "XLM",
    duration: 86400,
    xdrParams: "",
    status: "COMPLETED",
    viewCount: 12,
    lastViewedAt: "2026-07-15T00:00:00.000Z",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    shareUrl: "https://stellarstream.app/invoice/def456",
    description: undefined,
    customMessage: undefined,
    pdfUrl: undefined,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(INVOICES),
  });
});

describe("InvoiceLinksPage QR code toggle", () => {
  it("does not render the QR panel until Show QR is clicked", async () => {
    render(<InvoiceLinksPage />);

    await waitFor(() => {
      expect(screen.getByTestId("toggle-qr-inv_1")).toBeInTheDocument();
    });
    expect(screen.queryByText(/download for print/i)).not.toBeInTheDocument();
  });

  it("shows the QR Studio panel for a row after clicking Show QR", async () => {
    render(<InvoiceLinksPage />);

    const toggleButton = await screen.findByTestId("toggle-qr-inv_1");
    fireEvent.click(toggleButton);

    expect(await screen.findByText(/download for print/i)).toBeInTheDocument();
    expect(screen.getByText(/hide qr/i)).toBeInTheDocument();
  });

  it("hides the QR Studio panel again after clicking Hide QR", async () => {
    render(<InvoiceLinksPage />);

    const toggleButton = await screen.findByTestId("toggle-qr-inv_1");
    fireEvent.click(toggleButton);
    await screen.findByText(/download for print/i);

    fireEvent.click(screen.getByTestId("toggle-qr-inv_1"));

    await waitFor(() => {
      expect(screen.queryByText(/download for print/i)).not.toBeInTheDocument();
    });
  });
});

describe("InvoiceLinksPage Create Payment Link", () => {
  it("shows the Create Payment Link button", async () => {
    render(<InvoiceLinksPage />);
    await waitFor(() => {
      expect(screen.getByText(/create payment link/i)).toBeInTheDocument();
    });
  });

  it("opens the create modal when button is clicked", async () => {
    render(<InvoiceLinksPage />);
    const createButton = await screen.findByText(/create payment link/i);
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByText(/generate a shareable payment link/i)).toBeInTheDocument();
    });
  });

  it("displays analytics summary when Analytics button clicked", async () => {
    render(<InvoiceLinksPage />);
    const analyticsBtn = await screen.findByText(/analytics/i);
    fireEvent.click(analyticsBtn);

    await waitFor(() => {
      expect(screen.getByText(/total links/i)).toBeInTheDocument();
      expect(screen.getByText(/total views/i)).toBeInTheDocument();
    });
  });

  it("shows view count for each invoice", async () => {
    render(<InvoiceLinksPage />);
    await waitFor(() => {
      // The first invoice has 3 views
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });
});
