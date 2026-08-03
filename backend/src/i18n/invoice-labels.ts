import type { SupportedLanguage } from "./error-localization.js";

const FALLBACK_LANGUAGE: SupportedLanguage = "en";

// Kept as a TS module (not a .json import) so it works under the project's
// `module: "NodeNext"` setting without requiring JSON import attributes.
const invoiceLabelDictionary = {
  invoiceTitle: {
    en: "INVOICE",
    ar: "فاتورة",
    fr: "FACTURE",
    es: "FACTURA",
  },
  issued: {
    en: "Issued",
    ar: "تاريخ الإصدار",
    fr: "Emise le",
    es: "Emitida",
  },
  from: {
    en: "FROM",
    ar: "من",
    fr: "DE",
    es: "DE",
  },
  asset: {
    en: "ASSET",
    ar: "الأصل",
    fr: "ACTIF",
    es: "ACTIVO",
  },
  recipientAddress: {
    en: "RECIPIENT ADDRESS",
    ar: "عنوان المستلم",
    fr: "ADRESSE DU DESTINATAIRE",
    es: "DIRECCION DEL DESTINATARIO",
  },
  label: {
    en: "LABEL",
    ar: "التصنيف",
    fr: "ETIQUETTE",
    es: "ETIQUETA",
  },
  amount: {
    en: "AMOUNT",
    ar: "المبلغ",
    fr: "MONTANT",
    es: "IMPORTE",
  },
  subtotal: {
    en: "SUBTOTAL",
    ar: "المجموع الفرعي",
    fr: "SOUS-TOTAL",
    es: "SUBTOTAL",
  },
  tax: {
    en: "TAX",
    ar: "الضريبة",
    fr: "TAXE",
    es: "IMPUESTO",
  },
  total: {
    en: "TOTAL",
    ar: "الإجمالي",
    fr: "TOTAL",
    es: "TOTAL",
  },
  txHash: {
    en: "TX HASH",
    ar: "معرف المعاملة",
    fr: "HASH DE TRANSACTION",
    es: "HASH DE TRANSACCION",
  },
  footer: {
    en: "Generated {date} · StellarStream · Powered by Soroban",
    ar: "تم الإنشاء في {date} · StellarStream · مدعوم بواسطة Soroban",
    fr: "Genere le {date} · StellarStream · Propulse par Soroban",
    es: "Generado el {date} · StellarStream · Impulsado por Soroban",
  },
} as const satisfies Record<string, Record<SupportedLanguage, string>>;

type InvoiceLabelKey = keyof typeof invoiceLabelDictionary;

export type InvoiceLabels = Record<InvoiceLabelKey, string>;

/** Resolve the full set of invoice PDF/UI labels for a language, falling back to English. */
export function getInvoiceLabels(language: SupportedLanguage = FALLBACK_LANGUAGE): InvoiceLabels {
  const labels = {} as InvoiceLabels;
  for (const key of Object.keys(invoiceLabelDictionary) as InvoiceLabelKey[]) {
    labels[key] = invoiceLabelDictionary[key][language] ?? invoiceLabelDictionary[key][FALLBACK_LANGUAGE];
  }
  return labels;
}
