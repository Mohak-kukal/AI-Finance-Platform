const express = require('express');
const axios = require('axios');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Categorize transaction using ML
router.post('/categorize', authenticateToken, async (req, res) => {
  try {
    const { merchant, description, amount } = req.body;

    if (!merchant && !description) {
      return res.status(400).json({ error: 'Merchant or description required' });
    }

    const response = await axios.post(`${process.env.ML_SERVICE_URL}/categorize`, {
      merchant,
      description,
      amount: parseFloat(amount)
    });

    res.json(response.data);
  } catch (error) {
    console.error('Categorization error:', error);
    res.status(500).json({ error: 'Failed to categorize transaction' });
  }
});

// Train ML model with user corrections
router.post('/train', authenticateToken, async (req, res) => {
  try {
    const { transaction_id, old_category, new_category } = req.body;

    // Verify transaction belongs to user
    const transaction = await db('transactions')
      .where({ id: transaction_id, user_id: req.user.userId })
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Record the correction
    await db('category_corrections').insert({
      user_id: req.user.userId,
      transaction_id,
      old_category,
      new_category
    });

    // Update the transaction
    await db('transactions')
      .where({ id: transaction_id })
      .update({ category: new_category });

    // Send training data to ML service
    const trainingData = {
      merchant: transaction.merchant,
      description: transaction.description,
      amount: transaction.amount,
      correct_category: new_category
    };

    await axios.post(`${process.env.ML_SERVICE_URL}/train`, trainingData);

    res.json({ message: 'Model retrained successfully' });
  } catch (error) {
    console.error('Training error:', error);
    res.status(500).json({ error: 'Failed to retrain model' });
  }
});

// Get spending predictions
router.get('/predict', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    const targetMonth = month || new Date().getMonth() + 2; // Next month
    const targetYear = year || new Date().getFullYear();

    // Get user's historical spending data
    const spendingData = await db('transactions')
      .select('category', 'amount', 'date')
      .where('user_id', req.user.userId)
      .where('amount', '<', 0) // Only expenses
      .orderBy('date', 'desc')
      .limit(1000); // Last 1000 transactions

    // Check minimum transaction requirement (15 transactions)
    const MIN_TRANSACTIONS = 15;
    if (spendingData.length < MIN_TRANSACTIONS) {
      return res.json({ 
        predictions: [],
        message: `Insufficient data for predictions. Please add at least ${MIN_TRANSACTIONS} transactions to enable AI predictions.`,
        insufficient_data: true,
        current_count: spendingData.length,
        required_count: MIN_TRANSACTIONS
      });
    }

    // Send data to ML service for prediction
    const response = await axios.post(`${process.env.ML_SERVICE_URL}/predict`, {
      user_id: req.user.userId,
      spending_data: spendingData,
      target_month: parseInt(targetMonth),
      target_year: parseInt(targetYear)
    });

    // Store predictions in database
    if (response.data.predictions && response.data.predictions.length > 0) {
      // Clear old predictions for this period
      await db('predictions')
        .where({
          user_id: req.user.userId,
          month: parseInt(targetMonth),
          year: parseInt(targetYear)
        })
        .del();

      // Insert new predictions
      const predictionRecords = response.data.predictions.map(pred => ({
        user_id: req.user.userId,
        category: pred.category,
        predicted_amount: pred.predicted_amount,
        month: parseInt(targetMonth),
        year: parseInt(targetYear)
      }));

      await db('predictions').insert(predictionRecords);
    }

    res.json(response.data);
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
});

// Get AI financial advice
router.post('/advice', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.body;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    // Check total transaction count first
    const totalTransactions = await db('transactions')
      .where('user_id', req.user.userId)
      .where('amount', '<', 0)
      .count('* as count')
      .first();

    const MIN_TRANSACTIONS = 10;
    if (parseInt(totalTransactions.count) < MIN_TRANSACTIONS) {
      return res.json({
        summary: `We need at least ${MIN_TRANSACTIONS} transactions to provide personalized financial advice. You currently have ${totalTransactions.count} transaction${totalTransactions.count !== 1 ? 's' : ''}.`,
        concerns: [],
        recommendations: [],
        positive_feedback: [],
        confidence_score: 0,
        insufficient_data: true,
        current_count: parseInt(totalTransactions.count),
        required_count: MIN_TRANSACTIONS
      });
    }

    // Get spending data for the last 3 months
    // currentMonth is 1-based (1-12), but Date constructor uses 0-based months
    const threeMonthsAgo = new Date(currentYear, currentMonth - 1 - 3, 1);
    const startDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
    // End date is the last day of current month
    // new Date(year, month, 0) gives last day of previous month, so use currentMonth (1-based) directly
    const lastDayOfCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDayOfCurrentMonth).padStart(2, '0')}`;

    // Get spending by category for last 3 months (monthly breakdown)
    const allTransactions = await db('transactions')
      .select('category', 'amount', 'date')
      .where('user_id', req.user.userId)
      .whereBetween('date', [startDate, endDate])
      .where('amount', '<', 0)
      .orderBy('date', 'desc');

    // Group by month and category
    const monthlySpending = {};
    allTransactions.forEach(transaction => {
      const date = new Date(transaction.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlySpending[monthKey]) {
        monthlySpending[monthKey] = {};
      }
      const category = transaction.category || 'other';
      monthlySpending[monthKey][category] = (monthlySpending[monthKey][category] || 0) + Math.abs(transaction.amount);
    });

    // Get current month spending (for budget comparison)
    const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const currentMonthEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
    const currentSpending = await db('transactions')
      .select('category')
      .sum('amount as total')
      .where('user_id', req.user.userId)
      .whereBetween('date', [currentMonthStart, currentMonthEnd])
      .where('amount', '<', 0)
      .groupBy('category');

    // Get budgets for current month
    const budgets = await db('budgets')
      .where({
        user_id: req.user.userId,
        month: parseInt(currentMonth),
        year: parseInt(currentYear)
      });

    // Get predictions for next month
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

    const predictions = await db('predictions')
      .where({
        user_id: req.user.userId,
        month: nextMonth,
        year: nextYear
      });

    const adviceData = {
      current_spending: currentSpending,
      monthly_spending: monthlySpending,
      budgets,
      predictions,
      user_id: req.user.userId,
      analysis_period_months: 3
    };

    const response = await axios.post(`${process.env.ML_SERVICE_URL}/advice`, adviceData);

    res.json(response.data);
  } catch (error) {
    console.error('Advice generation error:', error);
    res.status(500).json({ error: 'Failed to generate financial advice' });
  }
});

// Stream AI financial advice
router.post('/advice/stream', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.body;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    // Set headers for Server-Sent Events at the very beginning
    // This ensures headers are set before any response is written
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Check total transaction count first
    const totalTransactions = await db('transactions')
      .where('user_id', req.user.userId)
      .where('amount', '<', 0)
      .count('* as count')
      .first();

    const MIN_TRANSACTIONS = 10;
    if (parseInt(totalTransactions.count) < MIN_TRANSACTIONS) {
      const insufficientDataResponse = {
        summary: `We need at least ${MIN_TRANSACTIONS} transactions to provide personalized financial advice. You currently have ${totalTransactions.count} transaction${totalTransactions.count !== 1 ? 's' : ''}.`,
        concerns: [],
        recommendations: [],
        positive_feedback: [],
        confidence_score: 0,
        insufficient_data: true,
        current_count: parseInt(totalTransactions.count),
        required_count: MIN_TRANSACTIONS
      };
      
      // Send as SSE complete message
      res.write(`data: ${JSON.stringify({ type: 'complete', advice: insufficientDataResponse })}\n\n`);
      res.end();
      return;
    }

    // Get spending data for the last 3 months
    const threeMonthsAgo = new Date(currentYear, currentMonth - 1 - 3, 1);
    const startDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDayOfCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDayOfCurrentMonth).padStart(2, '0')}`;

    // Get spending by category for last 3 months (monthly breakdown)
    const allTransactions = await db('transactions')
      .select('category', 'amount', 'date')
      .where('user_id', req.user.userId)
      .whereBetween('date', [startDate, endDate])
      .where('amount', '<', 0)
      .orderBy('date', 'desc');

    // Group by month and category
    const monthlySpending = {};
    allTransactions.forEach(transaction => {
      const date = new Date(transaction.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlySpending[monthKey]) {
        monthlySpending[monthKey] = {};
      }
      const category = transaction.category || 'other';
      monthlySpending[monthKey][category] = (monthlySpending[monthKey][category] || 0) + Math.abs(transaction.amount);
    });

    // Get current month spending (for budget comparison)
    const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const currentMonthEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
    const currentSpending = await db('transactions')
      .select('category')
      .sum('amount as total')
      .where('user_id', req.user.userId)
      .whereBetween('date', [currentMonthStart, currentMonthEnd])
      .where('amount', '<', 0)
      .groupBy('category');

    // Get budgets for current month
    const budgets = await db('budgets')
      .where({
        user_id: req.user.userId,
        month: parseInt(currentMonth),
        year: parseInt(currentYear)
      });

    // Get predictions for next month
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

    const predictions = await db('predictions')
      .where({
        user_id: req.user.userId,
        month: nextMonth,
        year: nextYear
      });

    const adviceData = {
      current_spending: currentSpending,
      monthly_spending: monthlySpending,
      budgets,
      predictions,
      user_id: req.user.userId,
      analysis_period_months: 3
    };

    // Proxy the stream from ML service
    try {
      const streamResponse = await axios.post(
        `${process.env.ML_SERVICE_URL}/advice/stream`,
        adviceData,
        {
          responseType: 'stream',
          timeout: 120000 // 2 minutes timeout
        }
      );

      streamResponse.data.on('data', (chunk) => {
        res.write(chunk.toString());
      });

      streamResponse.data.on('end', () => {
        res.end();
      });

      streamResponse.data.on('error', (error) => {
        console.error('Stream error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      });
    } catch (error) {
      console.error('Stream request error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to start streaming' })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('Advice streaming error:', error);
    res.status(500).json({ error: 'Failed to generate financial advice' });
  }
});

// Get insights and analytics
router.get('/insights', authenticateToken, async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    // Spending trends - use TO_CHAR for better date handling
    const spendingTrends = await db('transactions')
      .select(db.raw("TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM-DD') as month"))
      .sum('amount as total')
      .where('user_id', req.user.userId)
      .where('amount', '<', 0) // Only expenses
      .whereBetween('date', [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]])
      .groupBy(db.raw("DATE_TRUNC('month', date)"))
      .orderBy('month');

    console.log('Spending trends query result:', spendingTrends); // Debug log
    console.log('Date range:', startDate.toISOString().split('T')[0], 'to', endDate.toISOString().split('T')[0]); // Debug log

    // Top categories
    const topCategories = await db('transactions')
      .select('category')
      .sum('amount as total')
      .count('* as count')
      .where('user_id', req.user.userId)
      .where('amount', '<', 0) // Only expenses
      .whereBetween('date', [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]])
      .whereNotNull('category')
      .where('category', '!=', '')
      .groupBy('category')
      .orderBy('total', 'asc') // Most negative (highest spending) first
      .limit(10);

    console.log('Top categories query result:', topCategories); // Debug log

    // Top merchants
    const topMerchants = await db('transactions')
      .select('merchant')
      .sum('amount as total')
      .count('* as count')
      .where('user_id', req.user.userId)
      .where('amount', '<', 0)
      .whereBetween('date', [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]])
      .whereNotNull('merchant')
      .groupBy('merchant')
      .orderBy('total', 'asc')
      .limit(10);

    // Convert totals to numbers (PostgreSQL returns strings)
    const formattedTrends = spendingTrends.map(trend => ({
      month: trend.month,
      total: parseFloat(trend.total) || 0
    }));

    const formattedCategories = topCategories.map(cat => ({
      category: cat.category,
      total: parseFloat(cat.total) || 0,
      count: parseInt(cat.count) || 0
    }));

    const formattedMerchants = topMerchants.map(merchant => ({
      merchant: merchant.merchant,
      total: parseFloat(merchant.total) || 0,
      count: parseInt(merchant.count) || 0
    }));

    console.log('Formatted response:', { formattedTrends, formattedCategories, formattedMerchants }); // Debug log

    res.json({
      spending_trends: formattedTrends,
      top_categories: formattedCategories,
      top_merchants: formattedMerchants,
      period: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
        months: parseInt(months)
      }
    });
  } catch (error) {
    console.error('Insights error:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

module.exports = router;
