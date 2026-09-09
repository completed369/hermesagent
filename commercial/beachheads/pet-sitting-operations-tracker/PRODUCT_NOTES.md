# Pet-Sitting Business Operations Tracker

For solo pet sitters and dog walkers who want a local spreadsheet for visits, balances, expenses and miles. Six worksheets: Dashboard, Visits, Clients & Pets, Expenses, Services, and Guide & Sources. The included dashboard preview shows synthetic sample data, not VentureOS results.

## Conventions and limits

- XLSX file with 100 prepared input rows per operational sheet. Amber cells are inputs; blue cells contain formulas. Clear sample inputs without deleting rows. Extending capacity requires copying formulas and updating dashboard ranges.
- Sample amounts use dollars and distances use miles. Use one currency consistently. There is no currency conversion. The editable mileage allowance is a planning assumption, not a tax deduction rate.
- Cancelled visits carry no charge and are excluded from dashboard revenue/payment totals. Cancellation fees, refunds, tax, overpayments, and invoices require a separate record and reconciliation. Do not use this workbook as the payment system of record.
- Formula and rendering checks were performed with the spreadsheet runtime on 2026-09-09. Microsoft Excel, Google Sheets import, and LibreOffice compatibility have not been manually verified; do not advertise verified compatibility yet.
- No booking integration, automated reminders, card charging, external refresh, macros, or AI agent runs inside the workbook.
- The source workbook is publicly accessible in this repository. Do not market it as exclusive. A paid offer must clearly explain the additional service or convenience being sold.

## Current availability

Prepublication review only. No live checkout, purchase terms, support service level, or automatic customer delivery is verified. The existing test checkout is not a live offer. Price and seller terms must be accurate on the final purchase page before sales are enabled.

## Review evidence

Version 0.1.1 fixes cancelled-visit balances and sample-clearing instructions. Baseline dashboard values, a partial-to-full payment, and changed mileage rate recalculated as expected. All six tabs were rendered and reviewed. Table, validation, merged-cell, and frozen-pane counts were preserved during export. The manifest binds the reviewed file to its SHA-256. These checks do not establish customer usability, live delivery, or customer revenue.
