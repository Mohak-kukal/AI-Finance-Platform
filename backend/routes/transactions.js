const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { processRecurringTransactions } = require('../jobs/processRecurringTransactions');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG) and PDF files are allowed'));
    }
  }
});

// Get all unique categories for user
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const categories = await db('transactions')
      .where('user_id', req.user.userId)
      .whereNotNull('category')
      .where('category', '!=', '')
      .distinct('category')
      .pluck('category')
      .orderBy('category');

    // Base categories that should always be available
    const baseCategories = [
      'food', 'transportation', 'shopping', 'entertainment', 'utilities',
      'healthcare', 'education', 'travel', 'insurance', 'other'
    ];

    // Combine base categories with user's unique categories
    const allCategories = Array.from(new Set([...baseCategories, ...categories]))
      .filter(cat => cat && cat.trim() !== '')
      .sort();

    res.json({ categories: allCategories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get all transactions for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, account_id, category, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;

    let query = db('transactions')
      .leftJoin('accounts', 'transactions.account_id', 'accounts.id')
      .select(
        'transactions.*',
        'accounts.name as account_name',
        'accounts.type as account_type'
      )
      .where('transactions.user_id', req.user.userId);

    if (account_id) query = query.where('transactions.account_id', account_id);
    if (category) query = query.where('transactions.category', category);
    if (start_date) query = query.where('transactions.date', '>=', start_date);
    if (end_date) query = query.where('transactions.date', '<=', end_date);

    const transactions = await query
      .orderBy('transactions.date', 'desc')
      .orderBy('transactions.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const total = await db('transactions')
      .where('user_id', req.user.userId)
      .count('* as count')
      .first();

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total.count),
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Create new transaction
router.post('/', authenticateToken, [
  body('account_id').isInt({ min: 1 }).withMessage('Valid account ID required'),
  body('date').isISO8601().withMessage('Valid date required'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('merchant').optional().trim(),
  body('description').optional().trim(),
  body('category').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { account_id, date, amount, merchant, description, category, is_recurring } = req.body;

    // Verify account belongs to user
    const account = await db('accounts')
      .where({ id: account_id, user_id: req.user.userId })
      .first();

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const amountNumber = parseFloat(amount)
    const transactionDate = new Date(date)
    const dayOfMonth = transactionDate.getDate()
    const isExpense = amountNumber < 0
    
    // Create the transaction
    const [transaction] = await db('transactions').insert({
      user_id: req.user.userId,
      account_id,
      date,
      amount: amountNumber,
      merchant,
      description,
      category,
      is_recurring: is_recurring || false
    }).returning('*');

    // Update the account balance to reflect this transaction
    await db('accounts')
      .where({ id: account_id, user_id: req.user.userId })
      .update({
        balance: db.raw('balance + ?', [amountNumber])
      });

    // If this is a recurring transaction, create a recurring_transactions entry
    if (is_recurring) {
      await db('recurring_transactions').insert({
        user_id: req.user.userId,
        account_id,
        day_of_month: dayOfMonth,
        merchant,
        description,
        category,
        amount: Math.abs(amountNumber),
        is_expense: isExpense,
        start_date: date,
        last_processed: date,
        is_active: true
      });
    }

    res.status(201).json({
      message: 'Transaction created successfully',
      transaction
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Upload receipt and extract data
router.post('/uploadReceipt', authenticateToken, upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Send to ML service for OCR processing using stream
    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const ocrResponse = await axios.post(`${process.env.ML_SERVICE_URL}/ocr/extract`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000, // 60 seconds for OCR processing
    });

    const extractedData = ocrResponse.data;

    res.json({
      success: true,
      data: extractedData,
      message: 'Receipt processed successfully',
      filePath: req.file.path
    });
  } catch (error) {
    console.error('Receipt upload error:', error);
    
    // Provide more detailed error messages
    let errorMessage = 'Failed to process receipt';
    if (error.response) {
      // ML service error
      errorMessage = error.response.data?.error || error.response.data?.message || errorMessage;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'ML service is not available. Please ensure the ML service is running.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({ 
      success: false,
      error: errorMessage,
      data: {
        merchant: '',
        date: new Date().toISOString().split('T')[0],
        total_amount: 0,
        items: [],
        category: 'other',
        confidence: 0
      }
    });
  }
});

// Update transaction
router.put('/:id', authenticateToken, [
  body('account_id').optional().isInt({ min: 1 }).withMessage('Valid account ID required'),
  body('date').optional().isISO8601().withMessage('Valid date required'),
  body('amount').optional().isNumeric().withMessage('Amount must be a number'),
  body('merchant').optional().trim(),
  body('description').optional().trim(),
  body('category').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const updates = req.body;

    // Check if transaction belongs to user
    const transaction = await db('transactions')
      .where({ id, user_id: req.user.userId })
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const [updatedTransaction] = await db('transactions')
      .where({ id })
      .update(updates)
      .returning('*');

    res.json({
      message: 'Transaction updated successfully',
      transaction: updatedTransaction
    });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Delete transaction
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if transaction belongs to user
    const transaction = await db('transactions')
      .where({ id, user_id: req.user.userId })
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Reverse the transaction effect on the account balance before deleting
    await db('accounts')
      .where({ id: transaction.account_id, user_id: req.user.userId })
      .update({
        balance: db.raw('balance - ?', [parseFloat(transaction.amount)])
      });

    await db('transactions').where({ id }).del();

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// Bulk delete transactions
router.post('/bulk-delete', authenticateToken, async (req, res) => {
  try {
    const { transaction_ids } = req.body;

    if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return res.status(400).json({ error: 'Transaction IDs array is required' });
    }

    // Get all transactions that belong to the user
    const transactions = await db('transactions')
      .where('user_id', req.user.userId)
      .whereIn('id', transaction_ids);

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'No valid transactions found' });
    }

    // Reverse the transaction effects on account balances
    for (const transaction of transactions) {
      await db('accounts')
        .where({ id: transaction.account_id, user_id: req.user.userId })
        .update({
          balance: db.raw('balance - ?', [parseFloat(transaction.amount)])
        });
    }

    // Delete the transactions
    const deletedCount = await db('transactions')
      .where('user_id', req.user.userId)
      .whereIn('id', transaction_ids)
      .del();

    res.json({ 
      message: `${deletedCount} transaction(s) deleted successfully`,
      deleted_count: deletedCount
    });
  } catch (error) {
    console.error('Bulk delete transactions error:', error);
    res.status(500).json({ error: 'Failed to delete transactions' });
  }
});

// Export transactions as PDF for a specific account
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const { account_id, start_date, end_date } = req.query;

    if (!account_id) {
      return res.status(400).json({ error: 'Account ID is required' });
    }

    // Verify account belongs to user
    const account = await db('accounts')
      .where({ id: account_id, user_id: req.user.userId })
      .first();

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Build query
    let query = db('transactions')
      .leftJoin('accounts', 'transactions.account_id', 'accounts.id')
      .select(
        'transactions.id',
        'transactions.date',
        'transactions.amount',
        'transactions.merchant',
        'transactions.description',
        'transactions.category',
        'accounts.name as account_name'
      )
      .where('transactions.user_id', req.user.userId)
      .where('transactions.account_id', account_id);

    if (start_date) {
      query = query.where('transactions.date', '>=', start_date);
    }
    if (end_date) {
      query = query.where('transactions.date', '<=', end_date);
    }

    const transactions = await query
      .orderBy('transactions.date', 'desc')
      .orderBy('transactions.created_at', 'desc');

    const filename = `transactions_${account.name}_${start_date || 'all'}_${end_date || 'all'}.pdf`.replace(/[^a-z0-9._-]/gi, '_');

    // Generate PDF with error handling. We buffer the PDF first so we only send
    // headers once the document completes successfully.
    const doc = new PDFDocument({ margin: 50 });
    const pdfStream = new PassThrough();

    const chunks = [];
    pdfStream.on('data', (chunk) => chunks.push(chunk));
    pdfStream.on('end', () => {
      try {
        const pdfBuffer = Buffer.concat(chunks);
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }
        res.send(pdfBuffer);
      } catch (err) {
        console.error('PDF send error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send PDF' });
        } else {
          res.end();
        }
      }
    });
    pdfStream.on('error', (err) => {
      console.error('PDF stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream PDF' });
      } else {
        res.end();
      }
    });

    // Handle PDF errors
    doc.on('error', (err) => {
      console.error('PDF generation error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to generate PDF: ' + err.message });
      } else {
        res.end();
      }
    });
    doc.pipe(pdfStream);

    try {
      // Header
      doc.fontSize(20).text('Transaction Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12);
      doc.text(`Account: ${account.name}`, { align: 'left' });
      doc.text(`Account Type: ${account.type.charAt(0).toUpperCase() + account.type.slice(1)}`, { align: 'left' });
      
      if (start_date || end_date) {
        doc.text(`Date Range: ${start_date || 'Start'} to ${end_date || 'End'}`, { align: 'left' });
      } else {
        doc.text('Date Range: All Transactions', { align: 'left' });
      }
      
      doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'left' });
      doc.text(`Total Transactions: ${transactions.length}`, { align: 'left' });
      doc.moveDown();

      // Calculate totals
      const totalIncome = transactions
        .filter(t => (Number(t.amount) || 0) > 0)
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const totalExpenses = transactions
        .filter(t => (Number(t.amount) || 0) < 0)
        .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
      const netAmount = totalIncome - totalExpenses;

      doc.fontSize(14).text('Summary', { underline: true });
      doc.fontSize(11);
      doc.text(`Total Income: INR ${totalIncome.toFixed(2)}`, { align: 'left' });
      doc.text(`Total Expenses: INR ${totalExpenses.toFixed(2)}`, { align: 'left' });
      doc.text(`Net Amount: INR ${netAmount.toFixed(2)}`, { align: 'left' });
      doc.moveDown();

      // Table header
      doc.fontSize(12).text('Transactions', { underline: true });
      doc.moveDown(0.5);
      
      // Table columns
      const tableTop = doc.y;
      const itemHeight = 20;
      const pageHeight = 750;
      let y = tableTop;
      
      // Header row
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Date', 50, y);
      doc.text('Amount', 120, y);
      doc.text('Merchant', 200, y);
      doc.text('Description', 320, y);
      doc.text('Category', 450, y);
      y += itemHeight;
      
      // Draw line under header
      doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
      
      // Transaction rows
      doc.font('Helvetica').fontSize(9);
      transactions.forEach((transaction) => {
        // Check if we need a new page
        if (y > pageHeight - 50) {
          doc.addPage();
          y = 50;
          // Redraw header on new page
          doc.font('Helvetica-Bold').fontSize(10);
          doc.text('Date', 50, y);
          doc.text('Amount', 120, y);
          doc.text('Merchant', 200, y);
          doc.text('Description', 320, y);
          doc.text('Category', 450, y);
          y += itemHeight;
          doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
          doc.font('Helvetica').fontSize(9);
        }

        const date = new Date(transaction.date).toLocaleDateString() || 'N/A';
        const amountValue = Number(transaction.amount) || 0;
        const amount = amountValue.toFixed(2);
        const merchant = String(transaction.merchant || '').substring(0, 20) || 'N/A';
        const description = String(transaction.description || '').substring(0, 25) || 'N/A';
        const category = String(transaction.category || 'uncategorized').substring(0, 15);
        
        // Color code amounts
        if (amountValue < 0) {
          doc.fillColor('red');
        } else {
          doc.fillColor('green');
        }
        
        doc.text(date, 50, y);
        doc.text(`INR ${amount}`, 120, y);
        doc.text(merchant, 200, y);
        doc.text(description, 320, y);
        doc.text(category, 450, y);
        
        doc.fillColor('black'); // Reset color
        y += itemHeight;
      });

      // Finalize PDF
      doc.end();
    } catch (pdfError) {
      console.error('Error generating PDF content:', pdfError);
      console.error('PDF Error Stack:', pdfError.stack);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to generate PDF content: ' + pdfError.message });
      } else {
        res.end();
      }
    }
  } catch (error) {
    console.error('Export transactions error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export transactions: ' + error.message });
    }
  }
});

// Process recurring transactions (can be called daily via cron or manually)
router.post('/process-recurring', authenticateToken, async (req, res) => {
  try {
    const result = await processRecurringTransactions();
    res.json({
      message: 'Recurring transactions processed successfully',
      processed: result.processed
    });
  } catch (error) {
    console.error('Error processing recurring transactions:', error);
    res.status(500).json({ error: 'Failed to process recurring transactions' });
  }
});

// Get all recurring transactions for user
router.get('/recurring', authenticateToken, async (req, res) => {
  try {
    const { account_id } = req.query;
    const now = new Date();
    
    let query = db('recurring_transactions')
      .leftJoin('accounts', 'recurring_transactions.account_id', 'accounts.id')
      .select(
        'recurring_transactions.*',
        'accounts.name as account_name',
        'accounts.type as account_type'
      )
      .where('recurring_transactions.user_id', req.user.userId);

    if (account_id) {
      query = query.where('recurring_transactions.account_id', account_id);
    }

    // Order by: active first (is_active DESC), then by created_at DESC
    const recurringTransactions = await query
      .orderBy('recurring_transactions.is_active', 'desc')
      .orderBy('recurring_transactions.created_at', 'desc');

    // Fix any recurring transactions with future last_processed dates
    for (const recurring of recurringTransactions) {
      if (recurring.last_processed) {
        const lastProcessedDate = new Date(recurring.last_processed);
        // If last_processed is in the future, find the actual last processed date from transactions
        if (lastProcessedDate > now) {
          console.log(`Fixing future last_processed date for recurring transaction ${recurring.id}: ${recurring.last_processed}`);
          
          // Find the most recent transaction created from this recurring transaction
          // that has a date in the past (not future)
          const lastValidTransaction = await db('transactions')
            .where({
              user_id: recurring.user_id,
              account_id: recurring.account_id,
              recurring_transaction_id: recurring.id
            })
            .where('date', '<=', now.toISOString().split('T')[0]) // Only past/current dates
            .orderBy('date', 'desc')
            .first();
          
          let correctLastProcessed = null;
          if (lastValidTransaction) {
            correctLastProcessed = lastValidTransaction.date;
          }
          
          // Update the database with the correct last_processed date
          await db('recurring_transactions')
            .where({ id: recurring.id, user_id: req.user.userId })
            .update({ last_processed: correctLastProcessed });
          
          // Update the object in the response
          recurring.last_processed = correctLastProcessed;
        }
      } else {
        // If last_processed is null, try to find the most recent transaction to set it
        const lastValidTransaction = await db('transactions')
          .where({
            user_id: recurring.user_id,
            account_id: recurring.account_id,
            recurring_transaction_id: recurring.id
          })
          .where('date', '<=', now.toISOString().split('T')[0]) // Only past/current dates
          .orderBy('date', 'desc')
          .first();
        
        if (lastValidTransaction) {
          // Update the database with the found last_processed date
          await db('recurring_transactions')
            .where({ id: recurring.id, user_id: req.user.userId })
            .update({ last_processed: lastValidTransaction.date });
          
          // Update the object in the response
          recurring.last_processed = lastValidTransaction.date;
        }
      }
    }

    res.json({ recurring_transactions: recurringTransactions });
  } catch (error) {
    console.error('Get recurring transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch recurring transactions' });
  }
});

// Update recurring transaction
router.put('/recurring/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant, description, category, amount, day_of_month, end_date, is_active } = req.body;

    // Verify recurring transaction belongs to user
    const recurring = await db('recurring_transactions')
      .where({ id, user_id: req.user.userId })
      .first();

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring transaction not found' });
    }

    const updates = {};
    if (merchant !== undefined) updates.merchant = merchant;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (amount !== undefined) updates.amount = Math.abs(parseFloat(amount));
    if (day_of_month !== undefined) updates.day_of_month = parseInt(day_of_month);
    if (end_date !== undefined) updates.end_date = end_date || null;
    if (is_active !== undefined) updates.is_active = is_active;
    updates.updated_at = db.fn.now();

    await db('recurring_transactions')
      .where({ id, user_id: req.user.userId })
      .update(updates);

    const updated = await db('recurring_transactions')
      .leftJoin('accounts', 'recurring_transactions.account_id', 'accounts.id')
      .select(
        'recurring_transactions.*',
        'accounts.name as account_name',
        'accounts.type as account_type'
      )
      .where('recurring_transactions.id', id)
      .first();

    res.json({ recurring_transaction: updated });
  } catch (error) {
    console.error('Update recurring transaction error:', error);
    res.status(500).json({ error: 'Failed to update recurring transaction' });
  }
});

// Delete recurring transaction
router.delete('/recurring/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify recurring transaction belongs to user
    const recurring = await db('recurring_transactions')
      .where({ id, user_id: req.user.userId })
      .first();

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring transaction not found' });
    }

    // Hard delete - remove the recurring transaction from database
    // Note: This does NOT delete the actual transactions that were created from this recurring transaction
    // The transactions remain in the database with their recurring_transaction_id set
    await db('recurring_transactions')
      .where({ id, user_id: req.user.userId })
      .del();

    res.json({ message: 'Recurring transaction deleted successfully' });
  } catch (error) {
    console.error('Delete recurring transaction error:', error);
    res.status(500).json({ error: 'Failed to delete recurring transaction' });
  }
});

module.exports = router;
