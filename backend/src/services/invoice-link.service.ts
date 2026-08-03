import { prisma } from "../lib/db.js";
import { randomUUID } from "crypto";

export interface CreateInvoiceLinkInput {
  sender: string;
  receiver: string;
  amount: string;
  tokenAddress: string;
  duration: number;
  description?: string;
  customMessage?: string;
  pdfUrl?: string;
  expiresAt?: Date;
}

export interface InvoiceLinkResponse {
  id: string;
  slug: string;
  sender: string;
  receiver: string;
  amount: string;
  tokenAddress: string;
  duration: number;
  description?: string;
  customMessage?: string;
  pdfUrl?: string;
  xdrParams: string;
  status: string;
  expiresAt?: Date;
  viewCount: number;
  lastViewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  shareUrl: string;
}

export interface InvoiceLinkAnalytics {
  id: string;
  slug: string;
  amount: string;
  tokenAddress: string;
  status: string;
  viewCount: number;
  lastViewedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
  shareUrl: string;
}

export class InvoiceLinkService {
  /**
   * Generate XDR parameters for stream initialization
   */
  private generateXdrParams(input: CreateInvoiceLinkInput): string {
    // Encode stream parameters as XDR-compatible JSON
    const params = {
      receiver: input.receiver,
      amount: input.amount,
      tokenAddress: input.tokenAddress,
      duration: input.duration,
      startTime: Math.floor(Date.now() / 1000),
    };
    return Buffer.from(JSON.stringify(params)).toString("base64");
  }

  /**
   * Create a new invoice link (draft)
   */
  async createInvoiceLink(
    input: CreateInvoiceLinkInput,
  ): Promise<InvoiceLinkResponse> {
    const slug = randomUUID().split("-")[0]; // Short UUID
    const xdrParams = this.generateXdrParams(input);

    const link = await prisma.invoiceLink.create({
      data: {
        slug,
        sender: input.sender,
        receiver: input.receiver,
        amount: input.amount,
        tokenAddress: input.tokenAddress,
        duration: input.duration,
        description: input.description,
        customMessage: input.customMessage,
        pdfUrl: input.pdfUrl,
        xdrParams,
        status: "DRAFT",
        expiresAt: input.expiresAt,
      },
    });

    return this.formatResponse(link);
  }

  /**
   * Retrieve invoice link by slug with view tracking
   */
  async getInvoiceLinkBySlug(slug: string): Promise<InvoiceLinkResponse | null> {
    const link = await prisma.invoiceLink.findUnique({
      where: { slug },
    });

    if (!link) return null;

    // Check expiration
    if (link.expiresAt && link.expiresAt < new Date()) {
      await prisma.invoiceLink.update({
        where: { id: link.id },
        data: { status: "EXPIRED" },
      });
      return null;
    }

    // Track view (analytics) and get the updated record
    await this.recordView(link.id, link.viewCount);
    const updatedLink = await prisma.invoiceLink.findUnique({
      where: { id: link.id },
    });

    return this.formatResponse(updatedLink ?? link);
  }

  /**
   * Record a view on an invoice link for analytics
   */
  async recordView(linkId: string, currentViewCount: number): Promise<void> {
    try {
      await prisma.invoiceLink.update({
        where: { id: linkId },
        data: {
          viewCount: currentViewCount + 1,
          lastViewedAt: new Date(),
        },
      });
    } catch {
      // Non-critical: silently ignore view tracking failures
    }
  }

  /**
   * Get analytics for all invoice links owned by a sender
   */
  async getAnalytics(
    sender: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<InvoiceLinkAnalytics[]> {
    const links = await prisma.invoiceLink.findMany({
      where: { sender },
      orderBy: { viewCount: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        slug: true,
        amount: true,
        tokenAddress: true,
        status: true,
        viewCount: true,
        lastViewedAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    return links.map((link) => ({
      ...link,
      shareUrl: `${baseUrl}/invoice/${link.slug}`,
    }));
  }

  /**
   * Update invoice link status (e.g., DRAFT → SIGNED → COMPLETED)
   */
  async updateInvoiceLinkStatus(
    id: string,
    status: string,
  ): Promise<InvoiceLinkResponse> {
    const link = await prisma.invoiceLink.update({
      where: { id },
      data: { status },
    });

    return this.formatResponse(link);
  }

  /**
   * List invoice links for a sender
   */
  async listInvoiceLinks(
    sender: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<InvoiceLinkResponse[]> {
    const links = await prisma.invoiceLink.findMany({
      where: { sender },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return links.map((link) => this.formatResponse(link));
  }

  /**
   * Delete an invoice link
   */
  async deleteInvoiceLink(id: string): Promise<void> {
    await prisma.invoiceLink.delete({
      where: { id },
    });
  }

  /**
   * Format response with share URL and analytics
   */
  private formatResponse(link: any): InvoiceLinkResponse {
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    return {
      id: link.id,
      slug: link.slug,
      sender: link.sender,
      receiver: link.receiver,
      amount: link.amount,
      tokenAddress: link.tokenAddress,
      duration: link.duration,
      description: link.description,
      customMessage: link.customMessage,
      pdfUrl: link.pdfUrl,
      xdrParams: link.xdrParams,
      status: link.status,
      expiresAt: link.expiresAt,
      viewCount: link.viewCount ?? 0,
      lastViewedAt: link.lastViewedAt,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      shareUrl: `${baseUrl}/invoice/${link.slug}`,
    };
  }
}

export const invoiceLinkService = new InvoiceLinkService();
