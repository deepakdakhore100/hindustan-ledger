let currentOrgId = 1;
let accountsList = [];
let lineCounter = 0;

// DOM Elements
const orgSelector = document.getElementById('orgSelector');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const linesBody = document.getElementById('linesBody');
const addLineBtn = document.getElementById('addLineBtn');
const totalDebitEl = document.getElementById('totalDebit');
const totalCreditEl = document.getElementById('totalCredit');
const balanceStatusEl = document.getElementById('balanceStatus');
const saveVoucherBtn = document.getElementById('saveVoucherBtn');
const voucherForm = document.getElementById('voucherForm');
const ledgerForm = document.getElementById('ledgerForm');
const historyBody = document.getElementById('historyBody');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Set today's date
  document.getElementById('voucherDate').valueAsDate = new Date();
  
  // Set initial voucher serial
  document.getElementById('voucherNumber').value = `VCH-${Date.now().toString().slice(-4)}`;

  await loadOrganizations();
  await refreshCurrentOrgData();

  setupTabs();
  setupEventListeners();
});

// Load Organizations into Select Menu
async function loadOrganizations() {
  try {
    const res = await fetch('/api/organizations');
    const orgs = await res.json();
    orgSelector.innerHTML = orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    currentOrgId = orgs[0]?.id || 1;
  } catch (err) {
    showToast('Failed to load organizations', 'error');
  }
}

// Reload Accounts and Vouchers when Org Changes
async function refreshCurrentOrgData() {
  await loadAccounts();
  resetVoucherLines();
  await loadVoucherHistory();
  await loadAccountBalances(); // <--- Add this line
}

// Load Accounts for active Org
async function loadAccounts() {
  try {
    const res = await fetch(`/api/accounts?org_id=${currentOrgId}`);
    accountsList = await res.json();
  } catch (err) {
    showToast('Failed to load accounts', 'error');
  }
}

// Reset Lines with 2 default empty lines (Debit and Credit)
function resetVoucherLines() {
  linesBody.innerHTML = '';
  lineCounter = 0;
  addVoucherLine(0, 0);
  addVoucherLine(0, 0);
  calculateTotals();
}

// Add a single line item
function addVoucherLine(initialDebit = 0, initialCredit = 0) {
  lineCounter++;
  const tr = document.createElement('tr');
  tr.id = `line-row-${lineCounter}`;

  const accountOptions = accountsList.map(a => 
    `<option value="${a.id}">[${a.sub_type}] ${a.name} (${a.account_code})</option>`
  ).join('');

  tr.innerHTML = `
    <td>
      <select class="line-account" required>
        <option value="" disabled selected>-- Select Ledger Account --</option>
        ${accountOptions}
      </select>
    </td>
    <td>
      <input type="number" step="0.01" class="line-debit mono text-right" value="${initialDebit}" min="0">
    </td>
    <td>
      <input type="number" step="0.01" class="line-credit mono text-right" value="${initialCredit}" min="0">
    </td>
    <td>
      <button type="button" class="btn-remove" onclick="removeLine('line-row-${lineCounter}')">&times;</button>
    </td>
  `;

  linesBody.appendChild(tr);

  // Attach auto-clearing logic: if entering Debit, Credit becomes 0, and vice versa
  const drInput = tr.querySelector('.line-debit');
  const crInput = tr.querySelector('.line-credit');

  drInput.addEventListener('input', () => {
    if (parseFloat(drInput.value) > 0) crInput.value = 0;
    calculateTotals();
  });

  crInput.addEventListener('input', () => {
    if (parseFloat(crInput.value) > 0) drInput.value = 0;
    calculateTotals();
  });
}

function removeLine(rowId) {
  const row = document.getElementById(rowId);
  if (linesBody.children.length > 2) {
    row.remove();
    calculateTotals();
  } else {
    showToast('A voucher must have at least 2 entries (Dr & Cr).', 'error');
  }
}

// Calculate Sums and Balance Verification
function calculateTotals() {
  let sumDr = 0;
  let sumCr = 0;

  document.querySelectorAll('.line-debit').forEach(input => {
    sumDr += parseFloat(input.value) || 0;
  });

  document.querySelectorAll('.line-credit').forEach(input => {
    sumCr += parseFloat(input.value) || 0;
  });

  totalDebitEl.textContent = `₹${sumDr.toFixed(2)}`;
  totalCreditEl.textContent = `₹${sumCr.toFixed(2)}`;

  const diff = Math.abs(sumDr - sumCr);

  if (diff < 0.01 && sumDr > 0) {
    balanceStatusEl.className = 'balance-indicator balanced';
    balanceStatusEl.textContent = '✓ Balanced';
    saveVoucherBtn.disabled = false;
  } else {
    balanceStatusEl.className = 'balance-indicator unbalanced';
    balanceStatusEl.textContent = `Diff: ₹${diff.toFixed(2)}`;
    saveVoucherBtn.disabled = true;
  }
}

// Setup Tab Navigation
function setupTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');

      if (btn.dataset.tab === 'tab-history') {
        loadVoucherHistory();
      }
      if (btn.dataset.tab === 'tab-balances') {
        loadAccountBalances();
      }
    });
  });
}

// Form Handlers
function setupEventListeners() {
  // Org switch
  orgSelector.addEventListener('change', async (e) => {
    currentOrgId = parseInt(e.target.value);
    showToast(`Switched Company to: ${e.target.options[e.target.selectedIndex].text}`, 'success');
    await refreshCurrentOrgData();
  });

  // Add line item
  addLineBtn.addEventListener('click', () => addVoucherLine(0, 0));

  // Save Customer / Supplier Ledger
  ledgerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      organization_id: currentOrgId,
      sub_type: document.querySelector('input[name="sub_type"]:checked').value,
      account_code: document.getElementById('accountCode').value,
      name: document.getElementById('accountName').value,
      gstin: document.getElementById('gstin').value,
      phone: document.getElementById('phone').value,
      opening_balance: parseFloat(document.getElementById('openingBalance').value) || 0,
      opening_balance_type: document.getElementById('openingBalanceType').value
    };

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      showToast(`Ledger "${payload.name}" created successfully!`, 'success');
      ledgerForm.reset();
      await loadAccounts();
      resetVoucherLines();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Save Voucher Entry
  voucherForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rows = linesBody.querySelectorAll('tr');
    const lines = [];

    for (const r of rows) {
      const accountId = r.querySelector('.line-account').value;
      const debit = parseFloat(r.querySelector('.line-debit').value) || 0;
      const credit = parseFloat(r.querySelector('.line-credit').value) || 0;

      if (!accountId) {
        showToast('Please select an account for every line.', 'error');
        return;
      }

      lines.push({ account_id: parseInt(accountId), debit, credit });
    }

    const payload = {
      organization_id: currentOrgId,
      voucher_type: document.querySelector('input[name="voucherType"]:checked').value,
      voucher_number: document.getElementById('voucherNumber').value,
      voucher_date: document.getElementById('voucherDate').value,
      reference_number: document.getElementById('referenceNumber').value,
      narration: document.getElementById('narration').value,
      lines: lines
    };

    try {
      const res = await fetch('/api/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      showToast('Voucher posted successfully!', 'success');
      voucherForm.reset();
      document.getElementById('voucherDate').valueAsDate = new Date();
      document.getElementById('voucherNumber').value = `VCH-${Date.now().toString().slice(-4)}`;
      resetVoucherLines();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// Load Transaction Register
async function loadVoucherHistory() {
  try {
    const res = await fetch(`/api/vouchers?org_id=${currentOrgId}`);
    const vouchers = await res.json();

    if (vouchers.length === 0) {
      historyBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding: 20px;">No transaction entries found for this organization.</td></tr>`;
      return;
    }

    historyBody.innerHTML = vouchers.map(v => {
      const linesDesc = v.lines.map(l => 
        `<div><strong>${l.account_name}</strong>: ${l.debit > 0 ? 'Dr ₹' + l.debit : 'Cr ₹' + l.credit}</div>`
      ).join('');

      return `
        <tr>
          <td>${new Date(v.voucher_date).toLocaleDateString('en-IN')}</td>
          <td><span class="memo-badge">${v.voucher_type}</span></td>
          <td class="mono"><strong>${v.voucher_number}</strong></td>
          <td>
            <div>${v.narration || '-'}</div>
            <small style="color:#64748b;">Ref: ${v.reference_number || 'None'}</small>
          </td>
          <td style="font-size: 0.82rem;">${linesDesc}</td>
          <td class="mono text-right font-weight-bold">₹${parseFloat(v.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load transaction history', 'error');
  }
}

// Toast helper
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3500);
}

// Global state for balances
let balancesData = [];

// DOM References for Balance Screen
const balancesBody = document.getElementById('balancesBody');
const balanceSearchInput = document.getElementById('balanceSearchInput');
const balanceFilterSelect = document.getElementById('balanceFilterSelect');
const statReceivables = document.getElementById('statReceivables');
const statPayables = document.getElementById('statPayables');
const statLiquid = document.getElementById('statLiquid');
const statParity = document.getElementById('statParity');
const balanceTotalDr = document.getElementById('balanceTotalDr');
const balanceTotalCr = document.getElementById('balanceTotalCr');

// 1. Fetch & Compute Balances from Server
async function loadAccountBalances() {
  try {
    const res = await fetch(`/api/account-balances?org_id=${currentOrgId}`);
    balancesData = await res.json();

    computeMetrics(balancesData);
    renderBalancesTable(balancesData);
  } catch (err) {
    showToast('Failed to load account balances', 'error');
  }
}

// 2. Compute KPI Metrics (Debtors, Creditors, Bank/Cash, Parity)
function computeMetrics(data) {
  let totalReceivable = 0;
  let totalPayable = 0;
  let liquidCashBank = 0;
  let grossDr = 0;
  let grossCr = 0;

  data.forEach((acc) => {
    const closing = parseFloat(acc.closing_balance) || 0;
    const isDr = acc.closing_balance_type === 'DR';

    grossDr += parseFloat(acc.total_debit) || 0;
    grossCr += parseFloat(acc.total_credit) || 0;

    // Customer Debtors (Debit closing balance is money owed to company)
    if (acc.sub_type === 'CUSTOMER') {
      if (isDr) totalReceivable += closing;
      else totalReceivable -= closing;
    }

    // Supplier Creditors (Credit closing balance is money company owes)
    if (acc.sub_type === 'SUPPLIER') {
      if (!isDr) totalPayable += closing;
      else totalPayable -= closing;
    }

    // Liquid funds (Bank and Cash accounts)
    if (acc.sub_type === 'CASH' || acc.sub_type === 'BANK') {
      if (isDr) liquidCashBank += closing;
      else liquidCashBank -= closing;
    }
  });

  statReceivables.textContent = `₹${totalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  statPayables.textContent = `₹${totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  statLiquid.textContent = `₹${liquidCashBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  balanceTotalDr.textContent = `₹${grossDr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  balanceTotalCr.textContent = `₹${grossCr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const diff = Math.abs(grossDr - grossCr);
  if (diff < 0.05) {
    statParity.textContent = '✓ BALANCED';
    statParity.style.color = 'var(--success)';
  } else {
    statParity.textContent = `DIFF ₹${diff.toFixed(2)}`;
    statParity.style.color = 'var(--danger)';
  }
}

// 3. Render Table with Filters & Search
function renderBalancesTable(data) {
  const searchTerm = (balanceSearchInput?.value || '').toLowerCase();
  const filterType = balanceFilterSelect?.value || 'ALL';

  const filtered = data.filter((acc) => {
    const matchesSearch =
      acc.name.toLowerCase().includes(searchTerm) ||
      acc.account_code.toLowerCase().includes(searchTerm);

    if (!matchesSearch) return false;

    if (filterType === 'ALL') return true;
    if (filterType === 'CUSTOMER') return acc.sub_type === 'CUSTOMER';
    if (filterType === 'SUPPLIER') return acc.sub_type === 'SUPPLIER';
    if (filterType === 'BANK_CASH') return acc.sub_type === 'BANK' || acc.sub_type === 'CASH';
    if (filterType === 'INCOME') return acc.account_type === 'INCOME';
    if (filterType === 'EXPENSE') return acc.account_type === 'EXPENSE';

    return true;
  });

  if (filtered.length === 0) {
    balancesBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding: 24px;">No matching ledger accounts found.</td></tr>`;
    return;
  }

  balancesBody.innerHTML = filtered
    .map((acc) => {
      const isDr = acc.closing_balance_type === 'DR';
      const badgeClass = isDr ? 'badge-dr' : 'badge-cr';

      return `
      <tr>
        <td class="mono font-bold" style="font-size:0.8rem;">${acc.account_code}</td>
        <td>
          <div class="font-bold">${acc.name}</div>
        </td>
        <td><span class="badge-type">${acc.sub_type}</span></td>
        <td class="mono text-right">₹${parseFloat(acc.opening_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} <small>${acc.opening_balance_type}</small></td>
        <td class="mono text-right" style="color:#0284c7;">₹${parseFloat(acc.total_debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td class="mono text-right" style="color:#b45309;">₹${parseFloat(acc.total_credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td class="mono text-right font-bold">
          ₹${parseFloat(acc.closing_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          <span class="balance-badge ${badgeClass}">${acc.closing_balance_type}</span>
        </td>
      </tr>
    `;
    })
    .join('');
}

// 4. Hook Listeners for Filtering & Search
if (balanceSearchInput) {
  balanceSearchInput.addEventListener('input', () => renderBalancesTable(balancesData));
}

if (balanceFilterSelect) {
  balanceFilterSelect.addEventListener('change', () => renderBalancesTable(balancesData));
}