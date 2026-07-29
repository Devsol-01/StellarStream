import * as pdfLib from 'pdf-lib';
import * as XLSX from 'xlsx';
import { logger } from '../logger.js';

export class ReportFormatterService {
  /**
   * Format report data as PDF
   */
  async formatAsPDF(reportData: {
    title: string;
    organizationName: string;
    generatedAt: Date;
    summary: any;
    data: any[];
    sections?: { title: string; content: any }[];
  }): Promise<Buffer> {
    logger.info('Formatting report as PDF', { title: reportData.title });

    try {
      const { PDFDocument, PDFPage, rgb } = pdfLib;
      const pdfDoc = await PDFDocument.create();

      // Add page
      const page = pdfDoc.addPage([8.5 * 72, 11 * 72]); // Letter size in points
      const { width, height } = page.getSize();

      let yPosition = height - 50;

      // Header
      page.drawText(reportData.title, {
        x: 50,
        y: yPosition,
        size: 24,
        color: rgb(0, 0, 0),
      });
      yPosition -= 40;

      page.drawText(`Organization: ${reportData.organizationName}`, {
        x: 50,
        y: yPosition,
        size: 12,
        color: rgb(0.5, 0.5, 0.5),
      });
      yPosition -= 20;

      page.drawText(`Generated: ${reportData.generatedAt.toISOString()}`, {
        x: 50,
        y: yPosition,
        size: 10,
        color: rgb(0.5, 0.5, 0.5),
      });
      yPosition -= 30;

      // Summary section
      page.drawText('Summary', {
        x: 50,
        y: yPosition,
        size: 14,
        color: rgb(0, 0, 0),
      });
      yPosition -= 20;

      if (reportData.summary) {
        const summaryText = Object.entries(reportData.summary)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');

        const lines = summaryText.split('\n');
        for (const line of lines) {
          if (yPosition < 100) {
            // Add new page if needed
            page.drawText(line, { x: 50, y: yPosition, size: 10 });
          } else {
            page.drawText(line, { x: 50, y: yPosition, size: 10 });
          }
          yPosition -= 15;
        }
      }

      // Footer with signature placeholder
      page.drawText('_________________', {
        x: 50,
        y: 30,
        size: 10,
      });
      page.drawText('Authorized Signature', {
        x: 50,
        y: 15,
        size: 9,
        color: rgb(0.5, 0.5, 0.5),
      });

      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    } catch (error) {
      logger.error('Failed to format PDF', error);
      throw new Error('PDF formatting failed');
    }
  }

  /**
   * Format report data as Excel
   */
  async formatAsExcel(reportData: {
    title: string;
    organizationName: string;
    generatedAt: Date;
    summary: any;
    data: any[];
    sections?: { title: string; rows: any[] }[];
  }): Promise<Buffer> {
    logger.info('Formatting report as Excel', { title: reportData.title });

    try {
      const workbook = XLSX.utils.book_new();

      // Summary sheet
      const summarySheet = XLSX.utils.json_to_sheet([
        { Metric: 'Organization', Value: reportData.organizationName },
        { Metric: 'Generated', Value: reportData.generatedAt.toISOString() },
        { Metric: 'Report Title', Value: reportData.title },
        {},
        ...Object.entries(reportData.summary || {}).map(([key, value]) => ({
          Metric: key,
          Value: String(value),
        })),
      ]);

      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // Data sheet
      if (reportData.data && reportData.data.length > 0) {
        const dataSheet = XLSX.utils.json_to_sheet(reportData.data);
        XLSX.utils.book_append_sheet(workbook, dataSheet, 'Transactions');
      }

      // Additional sections
      if (reportData.sections && reportData.sections.length > 0) {
        for (const section of reportData.sections) {
          const sectionSheet = XLSX.utils.json_to_sheet(section.rows);
          XLSX.utils.book_append_sheet(workbook, sectionSheet, section.title.substring(0, 31));
        }
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer as Buffer;
    } catch (error) {
      logger.error('Failed to format Excel', error);
      throw new Error('Excel formatting failed');
    }
  }

  /**
   * Format report data as JSON
   */
  async formatAsJSON(reportData: any): Promise<Buffer> {
    logger.info('Formatting report as JSON');

    try {
      const jsonString = JSON.stringify(reportData, (key, value) => {
        // Handle Decimal objects
        if (value && typeof value === 'object' && value.constructor?.name === 'Decimal') {
          return value.toString();
        }
        return value;
      }, 2);

      return Buffer.from(jsonString, 'utf-8');
    } catch (error) {
      logger.error('Failed to format JSON', error);
      throw new Error('JSON formatting failed');
    }
  }

  /**
   * Format report data as CSV
   */
  async formatAsCSV(reportData: {
    title: string;
    organizationName: string;
    generatedAt: Date;
    data: any[];
  }): Promise<Buffer> {
    logger.info('Formatting report as CSV');

    try {
      // Header
      const lines: string[] = [];
      lines.push(`"${reportData.title}"`);
      lines.push(`"Organization","${reportData.organizationName}"`);
      lines.push(`"Generated","${reportData.generatedAt.toISOString()}"`);
      lines.push('');

      // Data
      if (reportData.data && reportData.data.length > 0) {
        // Headers
        const headers = Object.keys(reportData.data[0]);
        lines.push(headers.map((h) => `"${h}"`).join(','));

        // Rows
        for (const row of reportData.data) {
          const values = headers.map((h) => {
            const value = row[h];
            const stringValue = String(value || '');
            return `"${stringValue.replace(/"/g, '""')}"`;
          });
          lines.push(values.join(','));
        }
      }

      const csv = lines.join('\n');
      return Buffer.from(csv, 'utf-8');
    } catch (error) {
      logger.error('Failed to format CSV', error);
      throw new Error('CSV formatting failed');
    }
  }

  /**
   * Generate digital signature for report
   */
  async generateSignature(reportBuffer: Buffer, privateKey: string): Promise<string> {
    logger.info('Generating digital signature for report');

    try {
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', privateKey)
        .update(reportBuffer)
        .digest('hex');
      return signature;
    } catch (error) {
      logger.error('Failed to generate signature', error);
      throw new Error('Signature generation failed');
    }
  }

  /**
   * Verify report signature
   */
  async verifySignature(reportBuffer: Buffer, signature: string, publicKey: string): Promise<boolean> {
    logger.info('Verifying report signature');

    try {
      const expectedSignature = await this.generateSignature(reportBuffer, publicKey);
      return signature === expectedSignature;
    } catch (error) {
      logger.error('Failed to verify signature', error);
      return false;
    }
  }
}

export const reportFormatterService = new ReportFormatterService();
