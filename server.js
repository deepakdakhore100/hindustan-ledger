const express = require('express');
const { Pool } = require('pg');
const { createAuth } = require('./auth');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
app.disable('x-powered-by');
app.use(express.json({limit:'100kb'}));
const auth=createAuth(pool);
app.use('/api/auth',auth.router);
app.use('/api',auth.requireAuth,auth.csrf);
app.use('/api/operations',require('./operations')(pool,auth));
const scopeAccount=async (req,res,next)=>{
  const id=Number(req.method==='GET'?req.query.org_id:req.body?.organization_id);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Valid organization required'});
  req.params.orgId=id;
  return auth.requireOrg(req,res,next);
};
app.use(['/api/accounts','/api/vouchers','/api/account-balances'],scopeAccount,auth.requireRole('OPERATOR'));
app.use((req,res,next)=>{
  if(req.path.startsWith('/api/')||req.path==='/login.html'||req.path==='/login.js'||req.path.startsWith('/css/'))return next();
  const token=(String(req.headers.cookie||'').match(/(?:^|; )hl_session=([a-f0-9]{64})/)||[])[1];
  if(!token)return res.redirect('/login.html');
  next();
});
app.use(express.static(path.join(__dirname,'public')));

// 1. Get all organizations
app.get('/api/organizations', async (req, res) => {
  try {
    const result = req.user.is_owner
      ? await pool.query('SELECT * FROM organizations ORDER BY id ASC')
      : await pool.query('SELECT o.* FROM organizations o JOIN app_user_roles r ON r.organization_id=o.id WHERE r.user_id=$1 ORDER BY o.id ASC',[req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// 2. Get accounts for a specific organization
app.get('/api/accounts', async (req, res) => {
  const { org_id } = req.query;
  try {
    const result = await pool.query(
      'SELECT * FROM accounts WHERE organization_id = $1 ORDER BY name ASC',
      [org_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// 3. Create a Customer or Supplier Ledger Account
app.post('/api/accounts', async (req, res) => {
  const {
    organization_id,
    account_code,
    name,
    sub_type,
    phone,
    gstin,
    opening_balance,
    opening_balance_type,
  } = req.body;

  // Customers are Assets (Sundry Debtors), Suppliers are Liabilities (Sundry Creditors)
  const account_type = sub_type === 'CUSTOMER' ? 'ASSET' : 'LIABILITY';

  try {
    const result = await pool.query(
      `INSERT INTO accounts 
      (organization_id, account_code, name, account_type, sub_type, phone, gstin, opening_balance, opening_balance_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING *`,
      [
        organization_id,
        account_code,
        name,
        account_type,
        sub_type,
        phone || null,
        gstin || null,
        opening_balance || 0,
        opening_balance_type || 'DR',
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Invalid or conflicting data' });
  }
});

// 4. Post Double-Entry Voucher (Payment, Receipt, Journal, Credit/Debit Memo)
app.post('/api/vouchers', async (req, res) => {
  const {
    organization_id,
    voucher_type,
    voucher_number,
    voucher_date,
    reference_number,
    narration,
    lines,
  } = req.body;

  if (!lines || lines.length < 2) {
    return res.status(400).json({ error: 'A voucher must contain at least two line items.' });
  }

  // Validate Double Entry: Sum(Debit) === Sum(Credit)
  const totalDebit = lines.reduce((acc, l) => acc + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((acc, l) => acc + (parseFloat(l.credit) || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({
      error: `Unbalanced voucher! Total Debit (₹${totalDebit}) must equal Total Credit (₹${totalCredit}).`,
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert Voucher Header
    const voucherRes = await client.query(
      `INSERT INTO vouchers 
      (organization_id, voucher_type, voucher_number, voucher_date, reference_number, narration, total_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        organization_id,
        voucher_type,
        voucher_number,
        voucher_date,
        reference_number,
        narration,
        totalDebit,
      ]
    );

    const voucherId = voucherRes.rows[0].id;

    // Insert Journal Lines
    for (const line of lines) {
      await client.query(
        `INSERT INTO journal_lines 
        (organization_id, voucher_id, account_id, debit_amount, credit_amount, line_narration)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          organization_id,
          voucherId,
          line.account_id,
          parseFloat(line.debit) || 0,
          parseFloat(line.credit) || 0,
          line.line_narration || narration,
        ]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Voucher posted successfully!', voucher: voucherRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: 'Invalid or conflicting data' });
  } finally {
    client.release();
  }
});

// 5. Get recent vouchers & journal entries
app.get('/api/vouchers', async (req, res) => {
  const { org_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT v.id, v.voucher_type, v.voucher_number, v.voucher_date, v.reference_number, 
              v.narration, v.total_amount, v.created_at,
              json_agg(json_build_object(
                'account_name', a.name,
                'debit', jl.debit_amount,
                'credit', jl.credit_amount
              )) as lines
       FROM vouchers v
       JOIN journal_lines jl ON v.id = jl.voucher_id
       JOIN accounts a ON jl.account_id = a.id
       WHERE v.organization_id = $1
       GROUP BY v.id
       ORDER BY v.voucher_date DESC, v.id DESC LIMIT 30`,
      [org_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// 6. Get Real-Time Account Balances & Trial Balance for active Org
app.get('/api/account-balances', async (req, res) => {
  const { org_id } = req.query;
  try {
    const query = `
      SELECT 
        a.id,
        a.account_code,
        a.name,
        a.account_type,
        a.sub_type,
        a.opening_balance,
        a.opening_balance_type,
        COALESCE(SUM(jl.debit_amount), 0)::NUMERIC(14, 2) AS total_debit,
        COALESCE(SUM(jl.credit_amount), 0)::NUMERIC(14, 2) AS total_credit,
        (
          (CASE WHEN a.opening_balance_type = 'DR' THEN a.opening_balance ELSE -a.opening_balance END)
          + COALESCE(SUM(jl.debit_amount), 0)
          - COALESCE(SUM(jl.credit_amount), 0)
        )::NUMERIC(14, 2) AS net_balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON a.id = jl.account_id
      WHERE a.organization_id = $1
      GROUP BY a.id
      ORDER BY a.account_type ASC, a.name ASC;
    `;

    const result = await pool.query(query, [org_id]);

    // Format closing balance & closing balance type (DR or CR)
    const formatted = result.rows.map((row) => {
      const net = parseFloat(row.net_balance) || 0;
      return {
        ...row,
        closing_balance: Math.abs(net).toFixed(2),
        closing_balance_type: net >= 0 ? 'DR' : 'CR',
      };
    });

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Database operation failed' });
  }
});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Internal server error'})});
app.use((err,req,res,next)=>{ console.error(err);res.status(500).json({error:'Internal server error'}); });
app.listen(port, () => {
  console.log(`Hindustan Ledger server running on http://localhost:${port}`);
});