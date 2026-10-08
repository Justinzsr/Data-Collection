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
 * The header as the downloaded file writes it (October 2026): upper case with
 * underscores, a Seller ID column, and TAX_ON_COMMISSION_FEE where the help
 * article says "Tax on Commission".
 */
export const WHATNOT_DOWNLOADED_HEADER = [
  "REPORT_START_DATE", "WEEK_NUMBER", "ORDER_PLACED_AT_UTC", "TRANSACTION_COMPLETED_AT_UTC", "SELLER_ID",
  "TRANSACTION_TYPE", "TRANSACTION_MESSAGE", "ORDER_ID", "LISTING_TITLE", "LISTING_DESCRIPTION", "PRODUCT_CATEGORY",
  "BUY_FORMAT", "SALE_TYPE", "QUANTITY_SOLD", "SKU", "COST_OF_GOODS", "LIVESTREAM_ID", "LIVESTREAM_TITLE",
  "BUYER_NAME", "BUYER_STATE", "BUYER_COUNTRY", "SHIPMENT_ID", "TRANSACTION_CURRENCY", "TRANSACTION_AMOUNT",
  "BUYER_PAID", "ORIGINAL_ITEM_PRICE", "COUPON_COST", "POST_COUPON_PRICE", "SHIPPING_FEE", "COMMISSION_FEE",
  "PAYMENT_PROCESSING_FEE", "TAX_ON_COMMISSION_FEE", "TAX_ON_PAYMENT_PROCESSING_FEE", "LEDGER_TRANSACTION_ID",
] as const;

export type DownloadedReportLine = Partial<Record<(typeof WHATNOT_DOWNLOADED_HEADER)[number], string>>;

/** Columns the download writes as bare numbers; it quotes every other value, blanks included. */
const BARE_DOWNLOADED_COLUMNS = new Set<string>(["WEEK_NUMBER", "SELLER_ID", "QUANTITY_SOLD", "SHIPMENT_ID"]);

/** A report laid out as Whatnot's download is: quoted names and values, bare numeric columns, LF line ends, a final newline. */
export function downloadedReportCsv(lines: DownloadedReportLine[]) {
  const quoted = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
  const rows = lines.map((line) => WHATNOT_DOWNLOADED_HEADER.map((column) => {
    const value = line[column] ?? "";
    return BARE_DOWNLOADED_COLUMNS.has(column) ? value : quoted(value);
  }).join(","));
  return `${[WHATNOT_DOWNLOADED_HEADER.map(quoted).join(","), ...rows].join("\n")}\n`;
}

export const WHATNOT_DOWNLOADED_WEEK = "2026-09-14";

/**
 * An $8 auction sale as the download writes it: placed at a show on Thursday
 * evening, Sep 10 (Pacific), completed Tuesday, Sep 15, in the week of Sep 14.
 */
export function downloadedSale(overrides: DownloadedReportLine = {}): DownloadedReportLine {
  return {
    REPORT_START_DATE: "2026-09-14 00:00:00",
    WEEK_NUMBER: "38",
    ORDER_PLACED_AT_UTC: "2026-09-11 03:05:10",
    TRANSACTION_COMPLETED_AT_UTC: "2026-09-15 19:20:45",
    SELLER_ID: "55500055",
    TRANSACTION_TYPE: "ORDER_EARNINGS",
    TRANSACTION_MESSAGE: "Earnings for selling a Test bracelet #3",
    ORDER_ID: "900000003",
    LISTING_TITLE: "Test bracelet #3",
    LISTING_DESCRIPTION: "One bracelet, shown “live” before bidding. It's the exact one you see.",
    PRODUCT_CATEGORY: "Handcrafted & Artisan Jewelry",
    BUY_FORMAT: "AUCTION",
    SALE_TYPE: "",
    QUANTITY_SOLD: "1",
    SKU: "",
    COST_OF_GOODS: "",
    LIVESTREAM_ID: "00000000-0000-4000-8000-000000000001",
    LIVESTREAM_TITLE: "Test studio show",
    BUYER_NAME: "synthetic_buyer_1",
    BUYER_STATE: "WA",
    BUYER_COUNTRY: "US",
    SHIPMENT_ID: "800000001.00000",
    TRANSACTION_CURRENCY: "USD",
    TRANSACTION_AMOUNT: "6.83",
    BUYER_PAID: "13.20",
    ORIGINAL_ITEM_PRICE: "8.00",
    COUPON_COST: "0.00",
    POST_COUPON_PRICE: "8.00",
    SHIPPING_FEE: "0.00",
    COMMISSION_FEE: "0.64",
    PAYMENT_PROCESSING_FEE: "0.53",
    TAX_ON_COMMISSION_FEE: "0.00",
    TAX_ON_PAYMENT_PROCESSING_FEE: "0.00",
    LEDGER_TRANSACTION_ID: "700000003",
    ...overrides,
  };
}

/** A giveaway as the download writes it: an ORDER_EARNINGS row at a $0 price whose negative amount is the shipping the seller paid. */
export function downloadedGiveaway(overrides: DownloadedReportLine = {}): DownloadedReportLine {
  return downloadedSale({
    ORDER_PLACED_AT_UTC: "2026-09-16 02:40:00",
    TRANSACTION_COMPLETED_AT_UTC: "2026-09-16 02:40:01",
    TRANSACTION_MESSAGE: "Charged deduction of $5.10 for giveaway order TestGiveaway1",
    ORDER_ID: "900000101",
    LISTING_TITLE: "Test giveaway #1",
    BUY_FORMAT: "GIVEAWAY",
    TRANSACTION_AMOUNT: "-5.10",
    BUYER_PAID: "0.00",
    ORIGINAL_ITEM_PRICE: "0.00",
    POST_COUPON_PRICE: "0.00",
    SHIPPING_FEE: "5.10",
    COMMISSION_FEE: "0.00",
    PAYMENT_PROCESSING_FEE: "0.00",
    LEDGER_TRANSACTION_ID: "700000101",
    ...overrides,
  });
}

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
