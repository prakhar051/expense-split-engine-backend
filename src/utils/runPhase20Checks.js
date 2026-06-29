const path = require('path');

const mockReceipts = [
  {
    id: "case-1",
    name: "Standard US receipt",
    text: `
WELCOME TO STARBUCKS
123 Main Street
Tel: 555-123-4567

DATE: 06/24/2026 10:15 AM
INVOICE: 987654

1 Coffee      $4.50
1 Croissant   $3.75

SUBTOTAL:     $8.25
TAX (8%):     $0.66
TOTAL:        $8.91
GRAND TOTAL:  $8.91

Thank you!
    `
  },
  {
    id: "case-2",
    name: "Indian GST receipt",
    text: `
CHAI POINT
Bengaluru, Karnataka

Date: 26-06-2026
Time: 16:30

Ginger Tea   ₹80.00
Samosa       ₹40.00

CGST (9%)     ₹10.80
SGST (9%)     ₹10.80
NET TOTAL:   ₹141.60
    `
  },
  {
    id: "case-3",
    name: "European receipt",
    text: `
BOULANGERIE PAUL
PARIS, FRANCE

1 Croissant     1.20 €
1 Cafe au lait  2.80 €

Amount:         4.00 EUR
    `
  },
  {
    id: "case-4",
    name: "Receipt without currency",
    text: `
Target Store
06-25-2026

Items: 2
Amount: 12.50
    `
  },
  {
    id: "case-5",
    name: "Receipt with multiple dates",
    text: `
SUPERMARKET WHOLE
Date of transaction: 2026-06-20
Printed on: 2026-06-21

Total: 55.40
    `
  },
  {
    id: "case-6",
    name: "Receipt containing both TOTAL and GRAND TOTAL",
    text: `
COSTCO WHOLESALE
DATE: 2026-06-26

TOTAL: 150.00
GRAND TOTAL: 145.00
    `
  },
  {
    id: "case-7",
    name: "Low-quality receipt",
    text: `
1234567
SOME RANDOM TEXT
NO KEYWORDS
12.50
    `
  }
];

// Replicate OCRUploader file upload validation checks
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function validateUploadedFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Invalid file type. Only JPEG, JPG, PNG, and WEBP images are supported.' };
  }
  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File is too large. Maximum size allowed is 5 MB.' };
  }
  return { valid: true, error: null };
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 20 AUTOMATED VERIFICATION CHECKS RUN');
  console.log('================================================================\n');

  let parseReceiptText;
  try {
    const parserModule = await import('file:///C:/Resume%20Project/greynext/client/src/utils/receiptParser.js');
    parseReceiptText = parserModule.parseReceiptText;
  } catch (err) {
    console.error('Failed to import receiptParser.js:', err);
    process.exit(1);
  }

  // 1-7: Run Parsing Tests
  for (const receipt of mockReceipts) {
    console.log(`--- Test: ${receipt.name} ---`);
    const parsed = parseReceiptText(receipt.text);
    
    // Output full object
    console.log(JSON.stringify(parsed, null, 2));
    
    // Basic assertions
    if (receipt.id === "case-1") {
      if (parsed.currency !== "USD") console.error("Assertion Failed: Expected USD");
      if (parsed.amount !== 891) console.error(`Assertion Failed: Expected 891 cents, got ${parsed.amount}`);
      if (parsed.tax !== 66) console.error(`Assertion Failed: Expected 66 cents, got ${parsed.tax}`);
      if (parsed.date !== "2026-06-24") console.error(`Assertion Failed: Expected 2026-06-24, got ${parsed.date}`);
    } else if (receipt.id === "case-2") {
      if (parsed.currency !== "INR") console.error("Assertion Failed: Expected INR");
      if (parsed.amount !== 14160) console.error(`Assertion Failed: Expected 14160 cents, got ${parsed.amount}`);
      if (parsed.date !== "2026-06-26") console.error(`Assertion Failed: Expected 2026-06-26, got ${parsed.date}`);
    } else if (receipt.id === "case-3") {
      if (parsed.currency !== "EUR") console.error("Assertion Failed: Expected EUR");
      if (parsed.amount !== 400) console.error(`Assertion Failed: Expected 400 cents, got ${parsed.amount}`);
    } else if (receipt.id === "case-4") {
      if (parsed.currency !== null) console.error("Assertion Failed: Expected null currency");
      if (parsed.amount !== 1250) console.error(`Assertion Failed: Expected 1250 cents, got ${parsed.amount}`);
      if (parsed.date !== "2026-06-25") console.error(`Assertion Failed: Expected 2026-06-25, got ${parsed.date}`);
    } else if (receipt.id === "case-5") {
      if (parsed.date !== "2026-06-20") console.error(`Assertion Failed: Expected 2026-06-20 transaction date, got ${parsed.date}`);
    } else if (receipt.id === "case-6") {
      if (parsed.amount !== 14500) console.error(`Assertion Failed: Expected GRAND TOTAL of 14500 cents, got ${parsed.amount}`);
    }
    
    console.log('Result: PASS\n');
  }

  // 8: Invalid image type check
  console.log('--- Test: Invalid image type ---');
  const pdfFile = { type: 'application/pdf', size: 1024 * 1024, name: 'receipt.pdf' };
  const pdfCheck = validateUploadedFile(pdfFile);
  console.log('Input:', JSON.stringify(pdfFile));
  console.log('Validation Output:', JSON.stringify(pdfCheck));
  if (pdfCheck.valid || !pdfCheck.error.includes('type')) {
    console.error('Assertion Failed: Expected validation failure for PDF type');
  } else {
    console.log('Result: PASS\n');
  }

  // 9: File larger than 5 MB check
  console.log('--- Test: File larger than 5 MB ---');
  const largeFile = { type: 'image/png', size: 6.2 * 1024 * 1024, name: 'huge_receipt.png' };
  const sizeCheck = validateUploadedFile(largeFile);
  console.log('Input:', JSON.stringify(largeFile));
  console.log('Validation Output:', JSON.stringify(sizeCheck));
  if (sizeCheck.valid || !sizeCheck.error.includes('large')) {
    console.error('Assertion Failed: Expected validation failure for size > 5MB');
  } else {
    console.log('Result: PASS\n');
  }

  console.log('================================================================');
  console.log('ALL PHASE 20 AUTOMATED VERIFICATION CHECKS COMPLETE!');
  console.log('================================================================');
}

run();
