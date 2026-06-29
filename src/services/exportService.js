const prisma = require('../utils/prisma');
const PDFDocument = require('pdfkit');
const dashboardService = require('./dashboardService');

/**
 * Escapes characters for CSV values following RFC4180
 */
const escapeCSVField = (field) => {
  if (field === null || field === undefined) return '';
  let str = String(field);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }
  return str;
};

/**
 * Generates an RFC4180 compliant CSV string from headers and rows
 */
const generateCSV = (headers, rows) => {
  const headerRow = headers.map(escapeCSVField).join(',');
  const dataRows = rows.map(row => row.map(escapeCSVField).join(','));
  return [headerRow, ...dataRows].join('\r\n');
};

/**
 * Renders summary cards on the PDF doc
 */
const drawSummaryCards = (doc, cards, startY) => {
  const margin = 50;
  const gap = 15;
  const count = cards.length;
  const totalWidth = doc.page.width - margin * 2;
  const cardWidth = (totalWidth - (gap * (count - 1))) / count;
  
  cards.forEach((card, idx) => {
    const x = margin + idx * (cardWidth + gap);
    
    // Background card frame
    doc.save()
       .rect(x, startY, cardWidth, 60)
       .fillAndStroke('#F8FAFC', '#E2E8F0')
       .restore();
    
    // Label and Value
    doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(card.title, x + 10, startY + 12, { width: cardWidth - 20 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F172A').text(card.value, x + 10, startY + 28, { width: cardWidth - 20 });
  });
  
  return startY + 80;
};

/**
 * Draws a multi-page auto-wrapping repeating-header table on the PDF doc
 */
const drawTable = (doc, startY, headers, columns, rows) => {
  let y = startY;
  const margin = 50;
  const pageWidth = doc.page.width - margin * 2;
  const colWidths = columns.map(c => c.width * pageWidth);

  const drawRowBackground = (rowY, height, color) => {
    doc.save()
       .rect(margin, rowY - 4, pageWidth, height + 8)
       .fill(color)
       .restore();
  };

  const drawHeaders = (rowY) => {
    drawRowBackground(rowY, 15, '#F1F5F9');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1E293B');
    let x = margin;
    headers.forEach((h, idx) => {
      doc.text(h, x + 5, rowY, { width: colWidths[idx] - 10, align: columns[idx].align || 'left' });
      x += colWidths[idx];
    });
    return rowY + 20;
  };

  y = drawHeaders(y);

  rows.forEach((row, rowIndex) => {
    doc.font('Helvetica').fontSize(8);
    let maxCellHeight = 12;
    row.forEach((cell, idx) => {
      const cellHeight = doc.heightOfString(String(cell || ''), { width: colWidths[idx] - 10 });
      if (cellHeight > maxCellHeight) {
        maxCellHeight = cellHeight;
      }
    });

    if (y + maxCellHeight + 20 > doc.page.height - 70) {
      doc.addPage();
      y = margin + 20;
      y = drawHeaders(y);
      doc.font('Helvetica').fontSize(8);
    }

    if (rowIndex % 2 === 1) {
      drawRowBackground(y, maxCellHeight, '#F8FAFC');
    }

    doc.fillColor('#334155');
    let x = margin;
    row.forEach((cell, idx) => {
      doc.text(String(cell || ''), x + 5, y, { 
        width: colWidths[idx] - 10, 
        align: columns[idx].align || 'left',
        lineBreak: true
      });
      x += colWidths[idx];
    });

    doc.save()
       .strokeColor('#E2E8F0')
       .lineWidth(0.5)
       .moveTo(margin, y + maxCellHeight + 4)
       .lineTo(margin + pageWidth, y + maxCellHeight + 4)
       .stroke()
       .restore();

    y += maxCellHeight + 12;
  });

  return y;
};

/**
 * Appends page numbers and dynamic timestamps to the footer of all pages
 */
const addPageNumbersAndFooter = (doc) => {
  const range = doc.bufferedPageRange();
  const timestampStr = new Date().toLocaleString();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save()
       .strokeColor('#E2E8F0')
       .lineWidth(0.5)
       .moveTo(50, doc.page.height - 60)
       .lineTo(doc.page.width - 50, doc.page.height - 60)
       .stroke()
       .restore();

    doc.fontSize(7).font('Helvetica').fillColor('#94A3B8');
    
    // Page count center aligned
    doc.text(
      `Page ${i + 1} of ${range.count}`,
      50,
      doc.page.height - 48,
      { align: 'center', width: doc.page.width - 100 }
    );

    // Timestamp right aligned
    doc.text(
      `Generated: ${timestampStr} | SplitWise Pro`,
      50,
      doc.page.height - 48,
      { align: 'right', width: doc.page.width - 100 }
    );
  }
};

/**
 * Export Group Expenses to CSV format
 */
const exportExpensesCSV = async (groupId) => {
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: {
      payers: { include: { user: { select: { name: true } } } },
      participants: { include: { user: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const headers = ['Title', 'Category', 'Amount', 'Split Type', 'Payer(s)', 'Participants', 'Created Date'];
  
  const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
  const formatCurrency = (cents) => `${CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;

  const rows = expenses.map(exp => {
    const payersStr = exp.payers.map(p => `${p.user.name} (${formatCurrency(p.amount)})`).join(', ');
    const partsStr = exp.participants.map(p => `${p.user.name} (${formatCurrency(p.shareAmount)})`).join(', ');
    const dateStr = new Date(exp.createdAt).toISOString().split('T')[0];
    const amountStr = formatCurrency(exp.amount);
    
    return [
      exp.title || exp.description || 'Untitled',
      exp.category,
      amountStr,
      exp.splitType,
      payersStr,
      partsStr,
      dateStr
    ];
  });

  return generateCSV(headers, rows);
};

/**
 * Export Group Expenses to PDF and pipe to response
 */
const exportExpensesPDF = async (groupId, res, userId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { include: { user: { select: { name: true } } } } }
  });
  
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  const expenses = await prisma.expense.findMany({
    where: { groupId },
    include: {
      payers: { include: { user: { select: { name: true } } } },
      paidBy: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
  const formatCurrency = (cents) => `${CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;

  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  doc.pipe(res);

  const drawHeader = (reportType) => {
    doc.rect(50, 45, doc.page.width - 100, 2).fill('#4F46E5');
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#0F172A').text('SplitWise Pro', 50, 60);
    doc.fontSize(10).font('Helvetica').fillColor('#64748B').text(reportType, 50, 85);
    
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1E293B').text(`Generated By: ${user.name}`, 350, 60, { width: 212, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748B').text(`Date: ${new Date().toLocaleDateString()}`, 350, 75, { width: 212, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748B').text(`Group: ${group.name}`, 350, 88, { width: 212, align: 'right' });
    
    return 120;
  };

  let y = drawHeader('Group Expenses Report');

  // Summary Metrics
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  const cards = [
    { title: 'Total Members', value: String(group.members.length) },
    { title: 'Total Expenses', value: String(expenses.length) },
    { title: 'Total Expenses Amount', value: formatCurrency(totalAmount) }
  ];

  y = drawSummaryCards(doc, cards, y);

  // Statistics Computations
  const catTotals = {};
  const splitTotals = {};
  expenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
    splitTotals[e.splitType] = (splitTotals[e.splitType] || 0) + 1;
  });

  // Table header
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('Expenses List', 50, y);
  y += 20;

  if (expenses.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#64748B').text('No records available.', 50, y);
    y += 35;
  } else {
    const headers = ['Title', 'Category', 'Amount', 'Split Type', 'Payer', 'Date'];
    const columns = [
      { width: 0.25 },
      { width: 0.15 },
      { width: 0.15, align: 'right' },
      { width: 0.15 },
      { width: 0.18 },
      { width: 0.12 }
    ];
    const rows = expenses.map(e => {
      const payer = e.splitType === 'MULTI_PAYER' ? 'Multiple Payers' : (e.paidBy?.name || 'Unknown');
      return [
        e.title || e.description || 'Untitled',
        e.category,
        formatCurrency(e.amount),
        e.splitType,
        payer,
        new Date(e.createdAt).toISOString().split('T')[0]
      ];
    });

    y = drawTable(doc, y, headers, columns, rows);
  }

  // Statistics section
  if (y + 150 > doc.page.height - 70) {
    doc.addPage();
    y = drawHeader('Group Expenses Report') + 20;
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('Expense Breakdowns & Summaries', 50, y);
  y += 20;

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1E293B').text('Category Breakdown', 50, y);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1E293B').text('Split Type Summary', 300, y);
  y += 15;

  let catY = y;
  doc.fontSize(8);
  Object.entries(catTotals).forEach(([cat, amt]) => {
    doc.font('Helvetica-Bold').fillColor('#334155').text(cat, 50, catY);
    doc.font('Helvetica').fillColor('#334155').text(formatCurrency(amt), 180, catY, { align: 'right', width: 60 });
    catY += 14;
  });
  if (Object.keys(catTotals).length === 0) {
    doc.font('Helvetica-Oblique').fillColor('#64748B').text('No data', 50, catY);
    catY += 14;
  }

  let splitY = y;
  Object.entries(splitTotals).forEach(([type, count]) => {
    doc.font('Helvetica-Bold').fillColor('#334155').text(type, 300, splitY);
    doc.font('Helvetica').fillColor('#334155').text(`${count} item(s)`, 450, splitY, { align: 'right', width: 62 });
    splitY += 14;
  });
  if (Object.keys(splitTotals).length === 0) {
    doc.font('Helvetica-Oblique').fillColor('#64748B').text('No data', 300, splitY);
    splitY += 14;
  }

  y = Math.max(catY, splitY) + 20;

  if (expenses.length > 0) {
    const dates = expenses.map(e => new Date(e.createdAt));
    const minDate = new Date(Math.min(...dates)).toLocaleDateString();
    const maxDate = new Date(Math.max(...dates)).toLocaleDateString();
    doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(`Date Range: ${minDate} to ${maxDate} | Expense Count: ${expenses.length}`, 50, y);
  }

  addPageNumbersAndFooter(doc);
  doc.end();
};

/**
 * Export Group Settlements to CSV format
 */
const exportSettlementsCSV = async (groupId) => {
  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    include: {
      payer: { select: { name: true } },
      payee: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const headers = ['Payer', 'Payee', 'Amount', 'Status', 'Created Date'];

  const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
  const formatCurrency = (cents) => `${CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;

  const rows = settlements.map(s => {
    const dateStr = new Date(s.createdAt).toISOString().split('T')[0];
    return [
      s.payer.name,
      s.payee.name,
      formatCurrency(s.amount),
      s.status,
      dateStr
    ];
  });

  return generateCSV(headers, rows);
};

/**
 * Export Group Settlements to PDF format and pipe to response
 */
const exportSettlementsPDF = async (groupId, res, userId) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    include: {
      payer: { select: { name: true } },
      payee: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
  const formatCurrency = (cents) => `${CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;

  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  doc.pipe(res);

  const drawHeader = (reportType) => {
    doc.rect(50, 45, doc.page.width - 100, 2).fill('#4F46E5');
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#0F172A').text('SplitWise Pro', 50, 60);
    doc.fontSize(10).font('Helvetica').fillColor('#64748B').text(reportType, 50, 85);
    
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1E293B').text(`Generated By: ${user.name}`, 350, 60, { width: 212, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748B').text(`Date: ${new Date().toLocaleDateString()}`, 350, 75, { width: 212, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748B').text(`Group: ${group.name}`, 350, 88, { width: 212, align: 'right' });
    
    return 120;
  };

  let y = drawHeader('Group Settlements Report');

  // Summary counts
  let pendingSum = 0;
  let paidSum = 0;
  let disputedSum = 0;
  settlements.forEach(s => {
    if (s.status === 'PENDING') pendingSum += s.amount;
    else if (s.status === 'PAID') paidSum += s.amount;
    else if (s.status === 'DISPUTED') disputedSum += s.amount;
  });

  const cards = [
    { title: 'Total Settlements', value: String(settlements.length) },
    { title: 'Pending Amount', value: formatCurrency(pendingSum) },
    { title: 'Paid Amount', value: formatCurrency(paidSum) },
    { title: 'Disputed Amount', value: formatCurrency(disputedSum) }
  ];

  y = drawSummaryCards(doc, cards, y);

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('Settlements Status List', 50, y);
  y += 20;

  if (settlements.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#64748B').text('No records available.', 50, y);
    y += 35;
  } else {
    const headers = ['Payer (Debtor)', 'Payee (Creditor)', 'Amount', 'Status', 'Date'];
    const columns = [
      { width: 0.25 },
      { width: 0.25 },
      { width: 0.18, align: 'right' },
      { width: 0.17 },
      { width: 0.15 }
    ];
    const rows = settlements.map(s => [
      s.payer.name,
      s.payee.name,
      formatCurrency(s.amount),
      s.status,
      new Date(s.createdAt).toISOString().split('T')[0]
    ]);

    y = drawTable(doc, y, headers, columns, rows);
  }

  addPageNumbersAndFooter(doc);
  doc.end();
};

/**
 * Export User Dashboard Summary & Analytics to PDF format and pipe to response
 */
const exportDashboardPDF = async (userId, res) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  const analyticsService = require('./analyticsService');
  const forecastService = require('./forecastService');
  const budgetService = require('./budgetService');
  const aiInsightsService = require('./aiInsightsService');

  const kpis = await analyticsService.getDashboardMetrics(userId);
  const heatmap = await analyticsService.getSpendingHeatmap(userId, 'year');
  const merchants = await analyticsService.getMerchantAnalytics(userId, { limit: 10 });
  const categories = await analyticsService.getCategoryAnalytics(userId);
  const forecast = await forecastService.generateForecast(userId);
  const budgets = await budgetService.getBudgets(userId);
  
  const aiInsights = await prisma.aIInsight.findMany({
    where: { userId },
    orderBy: { generatedAt: 'desc' },
    take: 5
  });

  const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
  const formatCurrency = (cents) => {
    const sign = cents < 0 ? '-' : '';
    return `${sign}${CURRENCY_SYMBOL}${Math.abs(cents / 100).toFixed(2)}`;
  };

  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  doc.pipe(res);

  const drawHeader = (reportType) => {
    doc.rect(50, 45, doc.page.width - 100, 2).fill('#4F46E5');
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#0F172A').text('SplitWise Pro', 50, 60);
    doc.fontSize(10).font('Helvetica').fillColor('#64748B').text(reportType, 50, 85);
    
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1E293B').text(`Generated By: ${user.name}`, 350, 60, { width: 212, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748B').text(`Date: ${new Date().toLocaleString()}`, 350, 72, { width: 212, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748B').text(`App Version: 1.0.0 | Schema: 1.0.0`, 350, 84, { width: 212, align: 'right' });
    
    return 120;
  };

  let y = drawHeader('Advanced Financial Report');

  // Stage 1: KPI Cards
  const cards = [
    { title: 'Total Expenses', value: String(kpis.totalExpenses) },
    { title: 'Pending Settlements', value: String(kpis.pendingSettlements) },
    { title: 'Avg Daily Spend', value: formatCurrency(kpis.averageDailySpending) },
    { title: 'Avg Monthly Spend', value: formatCurrency(kpis.averageMonthlySpending) }
  ];
  y = drawSummaryCards(doc, cards, y);

  // Stage 2: Budget Summary
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('Budget Utilization Summary', 50, y);
  y += 20;

  if (budgets.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B').text('No active budgets.', 50, y);
    y += 25;
  } else {
    const headers = ['Period', 'Category', 'Limit', 'Spent', 'Remaining', 'Utilization %'];
    const columns = [
      { width: 0.15 },
      { width: 0.20 },
      { width: 0.18, align: 'right' },
      { width: 0.18, align: 'right' },
      { width: 0.18, align: 'right' },
      { width: 0.11, align: 'right' }
    ];
    const rows = budgets.map(b => [
      b.period,
      b.category || 'Overall',
      `${b.amount / 100} ${b.currency}`,
      `${b.spentAmount / 100} ${b.currency}`,
      `${b.remainingAmount / 100} ${b.currency}`,
      `${Math.round((b.spentAmount / b.amount) * 100)}%`
    ]);
    y = drawTable(doc, y, headers, columns, rows);
  }

  // Stage 3: Category Trends
  if (y + 180 > doc.page.height - 70) {
    doc.addPage();
    y = drawHeader('Advanced Financial Report') + 20;
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('Category Spending Trends', 50, y);
  y += 20;

  if (categories.breakdown.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B').text('No spending history.', 50, y);
    y += 25;
  } else {
    const headers = ['Month', ...categories.breakdown.slice(0, 3).map(c => c.category), 'Other'];
    const columns = [
      { width: 0.20 },
      { width: 0.20, align: 'right' },
      { width: 0.20, align: 'right' },
      { width: 0.20, align: 'right' },
      { width: 0.20, align: 'right' }
    ];
    
    const rows = categories.monthlyTrends.map(t => {
      const month = t.month;
      let otherSum = 0;
      const cells = [month];
      
      categories.breakdown.forEach((cat, idx) => {
        const amt = t[cat.category] || 0;
        if (idx < 3) {
          cells.push(formatCurrency(amt));
        } else {
          otherSum += amt;
        }
      });
      while (cells.length < 4) cells.push(formatCurrency(0));
      cells.push(formatCurrency(otherSum));
      return cells;
    });

    y = drawTable(doc, y, headers, columns, rows);
  }

  // Stage 4: Merchant Rankings
  if (y + 180 > doc.page.height - 70) {
    doc.addPage();
    y = drawHeader('Advanced Financial Report') + 20;
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('Top Merchant Rankings', 50, y);
  y += 20;

  if (merchants.data.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B').text('No merchant data.', 50, y);
    y += 25;
  } else {
    const headers = ['Merchant', 'Total Spend', 'Visits', 'Avg Spend'];
    const columns = [
      { width: 0.40 },
      { width: 0.20, align: 'right' },
      { width: 0.20, align: 'right' },
      { width: 0.20, align: 'right' }
    ];
    const rows = merchants.data.map(m => [
      m.merchant,
      formatCurrency(m.totalAmount),
      String(m.visitCount),
      formatCurrency(m.averageSpend)
    ]);
    y = drawTable(doc, y, headers, columns, rows);
  }

  // Stage 5: Forecast & Confidence Summary
  if (y + 180 > doc.page.height - 70) {
    doc.addPage();
    y = drawHeader('Advanced Financial Report') + 20;
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('30-Day Spending Forecast', 50, y);
  y += 15;
  doc.fontSize(9).font('Helvetica').fillColor('#334155').text(`Forecast Method: ${forecast.forecastMethod} | Confidence: ${forecast.confidence}% | Data Points Used: ${forecast.dataPointsUsed}`, 50, y);
  y += 15;
  doc.fontSize(9).font('Helvetica').fillColor('#334155').text(`Trend: ${forecast.trend} | Expected Daily Average: ${formatCurrency(forecast.expectedDailyAverage)} | Expected Monthly Spend: ${formatCurrency(forecast.expectedMonthlySpend)}`, 50, y);
  y += 25;

  // Stage 6: AI Spending Recommendations
  if (y + 180 > doc.page.height - 70) {
    doc.addPage();
    y = drawHeader('Advanced Financial Report') + 20;
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0F172A').text('AI Spending Recommendations & Anomalies', 50, y);
  y += 20;

  if (aiInsights.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B').text('No AI reports generated yet.', 50, y);
    y += 25;
  } else {
    const latestInsight = aiInsights[0];
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1E293B').text('Summary Overview:', 50, y);
    y += 12;
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(latestInsight.summary, 50, y, { width: doc.page.width - 100 });
    y += doc.heightOfString(latestInsight.summary, { width: doc.page.width - 100 }) + 15;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1E293B').text('Savings Recommendations:', 50, y);
    y += 12;
    const recommendations = typeof latestInsight.recommendations === 'string'
      ? JSON.parse(latestInsight.recommendations)
      : latestInsight.recommendations;
    recommendations.forEach((rec, idx) => {
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`${idx + 1}. ${rec}`, 60, y, { width: doc.page.width - 120 });
      y += doc.heightOfString(`${idx + 1}. ${rec}`, { width: doc.page.width - 120 }) + 6;
    });
    y += 10;
  }

  addPageNumbersAndFooter(doc);
  doc.end();
};

module.exports = {
  exportExpensesCSV,
  exportExpensesPDF,
  exportSettlementsCSV,
  exportSettlementsPDF,
  exportDashboardPDF
};
