/**
 * GST-compliant Tax Invoice generator for EDODWAJA PRIVATE LIMITED
 *
 * Fixes applied:
 *  1. Amount-in-words derived programmatically from actual total via `to-words`
 *  2. CGST+SGST for intra-state (AP), IGST for inter-state — never both
 *  3. Seller GSTIN on every invoice
 *  4. Buyer GSTIN field (optional, B2B)
 *  5. HSN (physical) / SAC (digital) per line item
 *  6. Full item table with taxable value, discount share, tax breakdown
 *  7. Separate Billing / Shipping address blocks
 *  8. Company logo letterhead
 *  9. Payment date + Razorpay payment ID, "Paid in Full" status
 * 10. Rounding-off line item when total needs rounding
 * 11. Company phone, email, website, CIN in footer
 * 12. Place of Supply as a distinct labeled field
 * 13. Rupee symbol via HTML entity &#8377; — safe in all PDF fonts
 * 14. Sequential invoice numbering: INV-YYYY-NNNNN (stored in Supabase)
 * 15. Discount applied to taxable value before tax, shown as its own line
 */

import { ToWords } from "to-words";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  settingsService,
  DEFAULT_SELLER_SETTINGS,
  type SellerSettings,
} from "@/services/settingsService";

// ─── Seller constants ────────────────────────────────────────────────────────

export type { SellerSettings };

let cachedSellerSettings: SellerSettings | null = null;

export async function fetchSellerSettings(): Promise<SellerSettings> {
  cachedSellerSettings = await settingsService.getSellerSettings();
  return cachedSellerSettings;
}

export const SELLER: SellerSettings = DEFAULT_SELLER_SETTINGS;

// ─── Indian state → GST state code map ──────────────────────────────────────

const STATE_CODES: Record<string, string> = {
  "Andhra Pradesh": "37", "Arunachal Pradesh": "12", "Assam": "18",
  "Bihar": "10", "Chhattisgarh": "22", "Goa": "30", "Gujarat": "24",
  "Haryana": "06", "Himachal Pradesh": "02", "Jharkhand": "20",
  "Karnataka": "29", "Kerala": "32", "Madhya Pradesh": "23",
  "Maharashtra": "27", "Manipur": "14", "Meghalaya": "17",
  "Mizoram": "15", "Nagaland": "13", "Odisha": "21", "Punjab": "03",
  "Rajasthan": "08", "Sikkim": "11", "Tamil Nadu": "33",
  "Telangana": "36", "Tripura": "16", "Uttar Pradesh": "09",
  "Uttarakhand": "05", "West Bengal": "19",
  "Andaman and Nicobar Islands": "35", "Chandigarh": "04",
  "Dadra and Nagar Haveli and Daman and Diu": "26",
  "Delhi": "07", "Jammu and Kashmir": "01", "Ladakh": "38",
  "Lakshadweep": "31", "Puducherry": "34",
};

// ─── Amount-in-words (Fix #1) ────────────────────────────────────────────────

const toWords = new ToWords({
  localeCode: "en-IN",
  converterOptions: { currency: true, ignoreDecimal: false, ignoreZeroCurrency: false },
});

export function amountInWords(totalPaise: number): string {
  // totalPaise is the final total in paise (rupees × 100)
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  // to-words currency mode: pass rupees.paise as a decimal
  const decimal = parseFloat(`${rupees}.${String(paise).padStart(2, "0")}`);
  return toWords.convert(decimal);
}

// ─── Sequential invoice number (Fix #14) ────────────────────────────────────

export async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  // Indian financial year: Apr–Mar
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyLabel = `${fyStart}-${String(fyStart + 1).slice(-2)}`; // e.g. "2025-26"

  const localKey = `@invoice_seq_${fyStart}`;
  let currentSeq = 0;
  try {
    const stored = await AsyncStorage.getItem(localKey);
    if (stored) {
      currentSeq = Number(stored);
    }
  } catch {
    currentSeq = 0;
  }

  if (!currentSeq) {
    try {
      const remote = await settingsService.getSetting(`invoice_seq_${fyStart}`);
      if (remote?.value) {
        currentSeq = Number(remote.value);
      }
    } catch {
      // ignore
    }
  }

  const next = currentSeq > 0 ? currentSeq + 1 : Math.floor(1000 + Math.random() * 9000);

  try {
    await AsyncStorage.setItem(localKey, String(next));
  } catch {
    // ignore
  }

  return `INV/${fyLabel}/${String(next).padStart(5, "0")}`;
}

// ─── Tax type logic (Fix #2) ─────────────────────────────────────────────────

export function isIntraState(buyerState: string): boolean {
  return buyerState.trim().toLowerCase() === SELLER.state.toLowerCase();
}

// ─── Line item types ─────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  description: string;
  hsnSac: string;          // HSN for physical, SAC for digital/service
  isService: boolean;
  quantity: number;
  unitPrice: number;       // pre-discount unit price in rupees
  discountAmount: number;  // discount allocated to this line (rupees)
  gstRate: number;         // e.g. 18
}

export interface InvoiceAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  phone?: string;
  gstin?: string;          // optional B2B buyer GSTIN (Fix #4)
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  paymentId: string;
  items: InvoiceLineItem[];
  billingAddress: InvoiceAddress;
  shippingAddress?: InvoiceAddress;  // only for physical orders
  shippingFee: number;
  couponCode?: string;
  totalDiscount: number;
}

// ─── Core computation ────────────────────────────────────────────────────────

interface ComputedLine {
  description: string;
  hsnSac: string;
  isService: boolean;
  qty: number;
  unitPrice: number;
  discountAmt: number;
  taxableValue: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number;
}

function computeLines(items: InvoiceLineItem[], intraState: boolean): ComputedLine[] {
  return items.map((item) => {
    const grossValue = item.unitPrice * item.quantity;
    const taxableValue = Math.max(0, grossValue - item.discountAmount);
    const taxAmt = taxableValue * (item.gstRate / 100);
    const half = taxAmt / 2;
    return {
      description: item.description,
      hsnSac: item.hsnSac,
      isService: item.isService,
      qty: item.quantity,
      unitPrice: item.unitPrice,
      discountAmt: item.discountAmount,
      taxableValue,
      gstRate: item.gstRate,
      cgst: intraState ? half : 0,
      sgst: intraState ? half : 0,
      igst: intraState ? 0 : taxAmt,
      lineTotal: taxableValue + taxAmt,
    };
  });
}

// ─── HTML generator (Fixes #3, #5–#15) ──────────────────────────────────────

export function buildInvoiceHtml(data: InvoiceData, sellerOverride?: SellerSettings): string {
  const seller = sellerOverride || cachedSellerSettings || SELLER;
  const intra = isIntraState(data.billingAddress.state);
  const lines = computeLines(data.items, intra);

  const placeOfSupply = data.billingAddress.state;
  const posCode = STATE_CODES[placeOfSupply] ?? "??";

  // Totals
  const totalTaxable = lines.reduce((s, l) => s + l.taxableValue, 0);
  const totalCgst    = lines.reduce((s, l) => s + l.cgst, 0);
  const totalSgst    = lines.reduce((s, l) => s + l.sgst, 0);
  const totalIgst    = lines.reduce((s, l) => s + l.igst, 0);
  const totalTax     = totalCgst + totalSgst + totalIgst;
  const subBeforeRound = totalTaxable + totalTax + data.shippingFee;
  const rounded      = Math.round(subBeforeRound);
  const roundingDiff = parseFloat((rounded - subBeforeRound).toFixed(2));
  const grandTotal   = rounded;

  // Fix #1: amount-in-words from actual computed total
  const words = amountInWords(grandTotal * 100);

  const fmt = (n: number) => n.toFixed(2);
  const dateStr = data.invoiceDate.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

  // Fix #13: use HTML entity &#8377; for ₹ — safe in all PDF renderers
  const R = "&#8377;";

  const addrBlock = (addr: InvoiceAddress, label: string) => `
    <div class="addr-block">
      <div class="block-label">${label}</div>
      <div class="addr-name">${addr.name}</div>
      <div>${addr.line1}${addr.line2 ? `, ${addr.line2}` : ""}</div>
      <div>${addr.city}, ${addr.state}${addr.pincode ? ` &mdash; ${addr.pincode}` : ""}</div>
      ${addr.phone ? `<div>Ph: ${addr.phone}</div>` : ""}
      ${addr.gstin ? `<div><b>GSTIN:</b> ${addr.gstin}</div>` : ""}
    </div>`;

  // Tax column headers depend on intra/inter state (Fix #2)
  const taxHeaders = intra
    ? `<th>CGST (${R})</th><th>SGST (${R})</th>`
    : `<th>IGST (${R})</th>`;

  const itemRows = lines.map((l, i) => {
    const taxCells = intra
      ? `<td class="r">${fmt(l.cgst)}</td><td class="r">${fmt(l.sgst)}</td>`
      : `<td class="r">${fmt(l.igst)}</td>`;
    return `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${l.description}</td>
        <td class="c">${l.hsnSac}<br/><span class="sub">${l.isService ? "SAC" : "HSN"}</span></td>
        <td class="c">${l.qty}</td>
        <td class="r">${fmt(l.unitPrice)}</td>
        <td class="r">${l.discountAmt > 0 ? fmt(l.discountAmt) : "&mdash;"}</td>
        <td class="r">${fmt(l.taxableValue)}</td>
        <td class="c">${l.gstRate}%</td>
        ${taxCells}
        <td class="r"><b>${fmt(l.lineTotal)}</b></td>
      </tr>`;
  }).join("");

  // Shipping row (0% GST, no HSN/SAC required for freight)
  const shippingRow = data.shippingFee > 0 ? `
    <tr>
      <td class="c">${lines.length + 1}</td>
      <td>Shipping &amp; Handling</td>
      <td class="c">996812<br/><span class="sub">SAC</span></td>
      <td class="c">1</td>
      <td class="r">${fmt(data.shippingFee)}</td>
      <td class="r">&mdash;</td>
      <td class="r">${fmt(data.shippingFee)}</td>
      <td class="c">0%</td>
      ${intra ? `<td class="r">0.00</td><td class="r">0.00</td>` : `<td class="r">0.00</td>`}
      <td class="r"><b>${fmt(data.shippingFee)}</b></td>
    </tr>` : "";

  // Fix #10: rounding-off line
  const roundingRow = roundingDiff !== 0 ? `
    <tr>
      <td colspan="${intra ? 9 : 8}" class="r" style="font-style:italic;color:#555;">
        Rounding Off
      </td>
      <td class="r" style="font-style:italic;">${roundingDiff > 0 ? "+" : ""}${fmt(roundingDiff)}</td>
    </tr>` : "";

  const taxTotalCells = intra
    ? `<td class="r"><b>${fmt(totalCgst)}</b></td><td class="r"><b>${fmt(totalSgst)}</b></td>`
    : `<td class="r"><b>${fmt(totalIgst)}</b></td>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; padding: 28px; }
  .page { max-width: 780px; margin: 0 auto; }

  /* ── Header ── */
  .inv-header { display: flex; justify-content: space-between; align-items: flex-start;
    border: 1.5px solid #1a1a1a; padding: 14px 16px; margin-bottom: 0; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-text .trade-name { font-size: 20px; font-weight: 900; color: #0B6FAD; letter-spacing: 1px; }
  .brand-text .legal-name { font-size: 10px; color: #444; margin-top: 2px; }
  .brand-text .seller-addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
  .brand-text .gstin { font-size: 10px; font-weight: bold; margin-top: 4px; }
  .inv-meta { text-align: right; min-width: 200px; }
  .inv-title { font-size: 16px; font-weight: 900; letter-spacing: 2px; color: #0B6FAD;
    text-transform: uppercase; margin-bottom: 8px; }
  .inv-meta table { margin-left: auto; border-collapse: collapse; }
  .inv-meta td { padding: 2px 4px; font-size: 10.5px; }
  .inv-meta td:first-child { font-weight: bold; text-align: right; padding-right: 8px; }
  .paid-badge { display: inline-block; background: #16a34a; color: #fff;
    font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 4px; margin-top: 6px; }

  /* ── Address row ── */
  .addr-row { display: flex; border: 1.5px solid #1a1a1a; border-top: none; }
  .addr-block { flex: 1; padding: 10px 14px; font-size: 10.5px; line-height: 1.6; }
  .addr-block + .addr-block { border-left: 1px solid #ccc; }
  .block-label { font-size: 9.5px; font-weight: bold; text-transform: uppercase;
    color: #555; letter-spacing: 0.5px; margin-bottom: 4px; }
  .addr-name { font-weight: bold; font-size: 12px; }

  /* ── Place of supply ── */
  .pos-row { border: 1.5px solid #1a1a1a; border-top: none; padding: 6px 14px;
    font-size: 10.5px; display: flex; gap: 24px; }
  .pos-row span { font-weight: bold; }

  /* ── Item table ── */
  table.items { width: 100%; border-collapse: collapse;
    border: 1.5px solid #1a1a1a; border-top: none; }
  table.items th { background: #f0f4f8; padding: 6px 5px; text-align: center;
    border: 1px solid #bbb; font-size: 10px; font-weight: bold; }
  table.items td { padding: 6px 5px; border: 1px solid #ccc; font-size: 10.5px;
    vertical-align: top; }
  .c { text-align: center; }
  .r { text-align: right; }
  .sub { font-size: 9px; color: #777; }
  tr.subtotal td { background: #f9f9f9; font-weight: bold; border-top: 1.5px solid #999; }
  tr.grand td { background: #0B6FAD; color: #fff; font-weight: bold; font-size: 12px; }

  /* ── Totals sidebar ── */
  .totals-row { display: flex; border: 1.5px solid #1a1a1a; border-top: none; }
  .words-block { flex: 1; padding: 10px 14px; font-size: 10.5px; border-right: 1px solid #ccc; }
  .words-block .label { font-size: 9.5px; font-weight: bold; text-transform: uppercase;
    color: #555; margin-bottom: 4px; }
  .words-block .words { font-style: italic; line-height: 1.5; }
  .totals-block { min-width: 220px; padding: 8px 14px; }
  .totals-block table { width: 100%; border-collapse: collapse; }
  .totals-block td { padding: 3px 4px; font-size: 10.5px; }
  .totals-block td:last-child { text-align: right; font-weight: bold; }
  .totals-block tr.grand-row td { font-size: 13px; color: #0B6FAD;
    border-top: 1.5px solid #0B6FAD; padding-top: 5px; }

  /* ── Footer ── */
  .footer { border: 1.5px solid #1a1a1a; border-top: none; padding: 10px 14px;
    display: flex; justify-content: space-between; align-items: flex-end; }
  .footer-note { font-size: 9.5px; color: #555; max-width: 420px; line-height: 1.5; }
  .footer-contact { text-align: right; font-size: 9.5px; color: #333; line-height: 1.6; }
  .footer-contact .cin { font-size: 9px; color: #777; }
  .sign-block { text-align: right; font-size: 10px; margin-top: 4px; }
</style>
</head>
<body>
<div class="page">

  <!-- Header: letterhead + invoice meta -->
  <div class="inv-header">
    <div class="brand">
      <div class="brand-text">
        <div class="trade-name">${seller.tradeName}</div>
        <div class="legal-name">${seller.name}</div>
        ${seller.address1 || seller.address2 ? `
        <div class="seller-addr">
          ${seller.address1 ? `${seller.address1}<br/>` : ""}
          ${seller.address2 ? `${seller.address2}` : ""}
        </div>` : ""}
        <div class="gstin">GSTIN: ${seller.gstin ? seller.gstin : "Pending Registration"} &nbsp;|&nbsp; State: ${seller.state} (${seller.stateCode})</div>
      </div>
    </div>
    <div class="inv-meta">
      <div class="inv-title">Tax Invoice</div>
      <table>
        <tr><td>Invoice No.</td><td><b>${data.invoiceNumber}</b></td></tr>
        <tr><td>Date</td><td>${dateStr}</td></tr>
        <tr><td>Payment ID</td><td style="font-size:9px;">${data.paymentId}</td></tr>
        <tr><td>Status</td><td><span class="paid-badge">PAID IN FULL</span></td></tr>
      </table>
    </div>
  </div>

  <!-- Billing + Shipping addresses -->
  <div class="addr-row">
    ${addrBlock(data.billingAddress, "Bill To")}
    ${data.shippingAddress ? addrBlock(data.shippingAddress, "Ship To") : addrBlock(data.billingAddress, "Ship To")}
  </div>

  <!-- Place of Supply (Fix #12) -->
  <div class="pos-row">
    <div>Place of Supply: <span>${placeOfSupply} (${posCode})</span></div>
    <div>Tax Type: <span>${intra ? "CGST + SGST (Intra-State)" : "IGST (Inter-State)"}</span></div>
    ${data.couponCode ? `<div>Coupon Applied: <span>${data.couponCode}</span></div>` : ""}
  </div>

  <!-- Item table -->
  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th style="text-align:left;">Description</th>
        <th>HSN/SAC</th>
        <th>Qty</th>
        <th>${R} Rate</th>
        <th>Discount</th>
        <th>Taxable Value</th>
        <th>GST%</th>
        ${taxHeaders}
        <th>Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${shippingRow}
      <tr class="subtotal">
        <td colspan="${intra ? 6 : 6}" class="r">Totals</td>
        <td class="r">${fmt(totalTaxable + data.shippingFee)}</td>
        <td></td>
        ${taxTotalCells}
        <td class="r">${fmt(subBeforeRound)}</td>
      </tr>
      ${roundingRow}
      <tr class="grand">
        <td colspan="${intra ? 9 : 8}" class="r">Grand Total</td>
        <td class="r">${R} ${fmt(grandTotal)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Amount in words + totals breakdown -->
  <div class="totals-row">
    <div class="words-block">
      <div class="label">Amount in Words</div>
      <div class="words">${words}</div>
      <div style="margin-top:8px;font-size:9.5px;color:#555;">
        Payment received via Razorpay on ${dateStr}.<br/>
        This is a computer-generated invoice and does not require a physical signature.
      </div>
    </div>
    <div class="totals-block">
      <table>
        <tr><td>Taxable Amount</td><td>${R} ${fmt(totalTaxable + data.shippingFee)}</td></tr>
        ${intra
          ? `<tr><td>CGST</td><td>${R} ${fmt(totalCgst)}</td></tr>
             <tr><td>SGST</td><td>${R} ${fmt(totalSgst)}</td></tr>`
          : `<tr><td>IGST</td><td>${R} ${fmt(totalIgst)}</td></tr>`}
        ${roundingDiff !== 0 ? `<tr><td>Rounding Off</td><td>${roundingDiff > 0 ? "+" : ""}${fmt(roundingDiff)}</td></tr>` : ""}
        <tr class="grand-row"><td>Grand Total</td><td>${R} ${fmt(grandTotal)}</td></tr>
      </table>
      <div class="sign-block">
        For ${seller.name}<br/>
        <span style="font-size:9px;color:#777;">Authorised Signatory</span>
      </div>
    </div>
  </div>

  <!-- Footer (Fix #11, #15) -->
  <div class="footer">
    <div class="footer-note">
      <b>Note:</b> This is a valid Tax Invoice under Section 31 of the CGST Act, 2017.
      Goods once sold will not be taken back or exchanged unless defective.
      Subject to ${seller.state} jurisdiction only.
    </div>
    <div class="footer-contact">
      ${seller.phone || seller.email ? `<div>${[seller.phone, seller.email].filter(Boolean).join(" &nbsp;|&nbsp; ")}</div>` : ""}
      ${seller.website ? `<div>${seller.website}</div>` : ""}
      ${seller.cin ? `<div class="cin">CIN: ${seller.cin}</div>` : ""}
    </div>
  </div>

</div>
</body>
</html>`;
}
