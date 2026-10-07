/* Synthetic Whatnot Weekly Orders Report rows for tests; no real seller or buyer data. */

export const WHATNOT_REPORT_HEADER = [
  "Report Start Date", "Week Number", "Order Placed At UTC", "Transaction Completed at UTC", "Transaction Type",
  "Transaction Message", "Order ID", "Listing Title", "Listing Description", "Product Category", "Buy Format",
  "Sale Type", "Quantity Sold", "SKU", "Cost of Goods", "Livestream ID", "Livestream Title", "Buyer Name",
  "Buyer State", "Buyer Country", "Shipment ID", "Transaction Currency", "Transaction Amount", "Buyer Paid",
  "Original Item Price", "Coupon Cost", "Post Coupon Price", "Shipping Fee", "Commission Fee",
  "Payment Processing Fee", "Tax on Commission", "Tax on Payment Processing Fee", "Ledger Transaction ID",
  "Order Refund Shipping Costs", "Appealed Order Refund", "Appealed Shipping Refund",
];

export type WhatnotReportLine = Partial<Record<(typeof WHATNOT_REPORT_HEADER)[number], string>>;

function csvCell(value: string) {
  return /[",\n]/u.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

export function weeklyReportCsv(lines: WhatnotReportLine[], header: readonly string[] = WHATNOT_REPORT_HEADER) {
  return [header.join(","), ...lines.map((line) => header.map((column) => csvCell((line as Record<string, string | undefined>)[column] ?? "")).join(","))].join("\r\n");
}

export const WHATNOT_TEST_WEEK = "2026-09-28";

/**
 * An order from a show on Friday, Sep 25 (Pacific), in the previous report week,
 * that completed after delivery on Wednesday, Sep 30 (Pacific), so it belongs to
 * the week of Sep 28. Real orders complete days after they are placed.
 */
export function whatnotSale(overrides: WhatnotReportLine = {}): WhatnotReportLine {
  return {
    "Report Start Date": WHATNOT_TEST_WEEK,
    "Week Number": "40",
    "Order Placed At UTC": "2026-09-26 02:15:00",
    "Transaction Completed at UTC": "2026-09-30 21:40:00",
    "Transaction Type": "Order Earnings",
    "Transaction Message": "Sold to @someone",
    "Order ID": "ORD-1",
    "Listing Title": "Moon bracelet",
    "Listing Description": "Sterling silver, \"crescent\" charm, gift box",
    "Product Category": "Jewelry",
    "Buy Format": "Auction",
    "Sale Type": "Livestream",
    "Quantity Sold": "1",
    "Livestream ID": "live-1",
    "Livestream Title": "Wednesday silver drop",
    "Buyer Name": "Private Person",
    "Buyer State": "CA",
    "Buyer Country": "US",
    "Shipment ID": "SHP-9",
    "Transaction Currency": "USD",
    "Transaction Amount": "$40.10",
    "Buyer Paid": "$52.40",
    "Original Item Price": "$48.00",
    "Coupon Cost": "$0.00",
    "Post Coupon Price": "$48.00",
    "Shipping Fee": "$4.40",
    "Commission Fee": "$3.84",
    "Payment Processing Fee": "$1.71",
    "Tax on Commission": "$0.00",
    "Tax on Payment Processing Fee": "$0.00",
    "Ledger Transaction ID": "L-1",
    ...overrides,
  };
}
