import { prisma } from "../lib/db.js";
import { NotFoundError, ValidationError } from "../lib/app-error.js";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_ACCENT_COLOR = "#00f5ff";

export interface CreateInvoiceTemplateInput {
  ownerAddress: string;
  name: string;
  language?: string;
  isDefault?: boolean;
  accentColor?: string;
  logoBase64?: string;
  footerText?: string;
}

export interface UpdateInvoiceTemplateInput {
  name?: string;
  language?: string;
  isDefault?: boolean;
  accentColor?: string;
  logoBase64?: string;
  footerText?: string;
}

function validateAccentColor(accentColor?: string): void {
  if (accentColor !== undefined && !HEX_COLOR_RE.test(accentColor)) {
    throw new ValidationError(
      `Invalid accentColor: "${accentColor}". Expected a 6-digit hex color, e.g. "#00f5ff".`,
    );
  }
}

export class InvoiceTemplateService {
  async listTemplates(ownerAddress: string) {
    return prisma.invoiceTemplate.findMany({
      where: { ownerAddress },
      orderBy: { createdAt: "desc" },
    });
  }

  async getTemplate(id: string) {
    const template = await prisma.invoiceTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError("InvoiceTemplate", id);
    return template;
  }

  /** The owner's default template, if one is set. */
  async getDefaultTemplate(ownerAddress: string) {
    return prisma.invoiceTemplate.findFirst({ where: { ownerAddress, isDefault: true } });
  }

  async createTemplate(input: CreateInvoiceTemplateInput) {
    validateAccentColor(input.accentColor);

    const data = {
      ownerAddress: input.ownerAddress,
      name: input.name,
      language: input.language ?? "en",
      isDefault: input.isDefault ?? false,
      accentColor: input.accentColor ?? DEFAULT_ACCENT_COLOR,
      logoBase64: input.logoBase64,
      footerText: input.footerText,
    };

    if (!data.isDefault) {
      return prisma.invoiceTemplate.create({ data });
    }

    // Only one default template per owner: clear the previous one atomically.
    return prisma.$transaction(async (tx) => {
      await tx.invoiceTemplate.updateMany({
        where: { ownerAddress: input.ownerAddress, isDefault: true },
        data: { isDefault: false },
      });
      return tx.invoiceTemplate.create({ data });
    });
  }

  async updateTemplate(id: string, input: UpdateInvoiceTemplateInput) {
    validateAccentColor(input.accentColor);

    const existing = await prisma.invoiceTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("InvoiceTemplate", id);

    const data = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      ...(input.accentColor !== undefined && { accentColor: input.accentColor }),
      ...(input.logoBase64 !== undefined && { logoBase64: input.logoBase64 }),
      ...(input.footerText !== undefined && { footerText: input.footerText }),
    };

    if (!input.isDefault) {
      return prisma.invoiceTemplate.update({ where: { id }, data });
    }

    return prisma.$transaction(async (tx) => {
      await tx.invoiceTemplate.updateMany({
        where: { ownerAddress: existing.ownerAddress, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
      return tx.invoiceTemplate.update({ where: { id }, data });
    });
  }

  async deleteTemplate(id: string) {
    const existing = await prisma.invoiceTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("InvoiceTemplate", id);

    await prisma.invoiceTemplate.delete({ where: { id } });
    return existing;
  }
}
