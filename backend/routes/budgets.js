const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all budgets for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    
    let query = db('budgets').where({ user_id: req.user.userId });
    
    if (month) query = query.where({ month: parseInt(month) });
    if (year) query = query.where({ year: parseInt(year) });

    const budgets = await query.orderBy('created_at', 'desc');

    res.json({ budgets });
  } catch (error) {
    console.error('Get budgets error:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// Create new budget
router.post('/', authenticateToken, [
  body('category').trim().isLength({ min: 1 }).withMessage('Category required'),
  body('limit_amount').isNumeric().withMessage('Limit amount must be a number'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Month must be between 1-12'),
  body('year').isInt({ min: 2020 }).withMessage('Valid year required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { category, limit_amount, month, year } = req.body;

    // Check if budget already exists for this category/month/year
    // For monthly budgets, only one monthly budget per month/year
    // For category budgets, only one budget per category/month/year
    const existingBudget = await db('budgets')
      .where({
        user_id: req.user.userId,
        category,
        month: parseInt(month),
        year: parseInt(year)
      })
      .first();

    if (existingBudget) {
      const errorMsg = category === 'monthly' 
        ? 'Monthly budget already exists for this period'
        : 'Budget already exists for this category and period';
      return res.status(400).json({ error: errorMsg });
    }

    const [budget] = await db('budgets').insert({
      user_id: req.user.userId,
      category,
      limit_amount: parseFloat(limit_amount),
      month: parseInt(month),
      year: parseInt(year)
    }).returning('*');

    res.status(201).json({
      message: 'Budget created successfully',
      budget
    });
  } catch (error) {
    console.error('Create budget error:', error);
    res.status(500).json({ error: 'Failed to create budget' });
  }
});

// Update budget
router.put('/:id', authenticateToken, [
  body('category').optional().trim().isLength({ min: 1 }).withMessage('Category cannot be empty'),
  body('limit_amount').optional().isNumeric().withMessage('Limit amount must be a number'),
  body('month').optional().isInt({ min: 1, max: 12 }).withMessage('Month must be between 1-12'),
  body('year').optional().isInt({ min: 2020 }).withMessage('Valid year required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const updates = req.body;

    // Check if budget belongs to user
    const budget = await db('budgets')
      .where({ id, user_id: req.user.userId })
      .first();

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const [updatedBudget] = await db('budgets')
      .where({ id })
      .update(updates)
      .returning('*');

    res.json({
      message: 'Budget updated successfully',
      budget: updatedBudget
    });
  } catch (error) {
    console.error('Update budget error:', error);
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

// Delete budget
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if budget belongs to user
    const budget = await db('budgets')
      .where({ id, user_id: req.user.userId })
      .first();

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    await db('budgets').where({ id }).del();

    res.json({ message: 'Budget deleted successfully' });
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

// Get budget analysis
router.get('/analysis', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    // Get budgets for the period
    const budgets = await db('budgets')
      .where({
        user_id: req.user.userId,
        month: parseInt(currentMonth),
        year: parseInt(currentYear)
      });

    // Get actual spending for the period
    const startDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const endDate = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];

    const spending = await db('transactions')
      .select('category')
      .sum('amount as total')
      .where('user_id', req.user.userId)
      .whereBetween('date', [startDate, endDate])
      .where('amount', '<', 0) // Only expenses
      .groupBy('category');

    // Get total monthly spending (for monthly budgets)
    const totalMonthlySpending = await db('transactions')
      .sum('amount as total')
      .where('user_id', req.user.userId)
      .whereBetween('date', [startDate, endDate])
      .where('amount', '<', 0) // Only expenses
      .first();

    const totalSpent = totalMonthlySpending ? Math.abs(totalMonthlySpending.total || 0) : 0;

    // Combine budgets with actual spending
    const analysis = budgets.map(budget => {
      let spent = 0;
      
      if (budget.category === 'monthly') {
        // For monthly budgets, use total spending
        spent = totalSpent;
      } else {
        // For category budgets, use category-specific spending
        const actualSpending = spending.find(s => s.category === budget.category);
        spent = actualSpending ? Math.abs(actualSpending.total) : 0;
      }
      
      const remaining = budget.limit_amount - spent;
      const percentage = (spent / budget.limit_amount) * 100;

      return {
        ...budget,
        spent,
        remaining,
        percentage: Math.round(percentage * 100) / 100,
        status: percentage > 100 ? 'over' : percentage > 80 ? 'warning' : 'good'
      };
    });

    res.json({ analysis });
  } catch (error) {
    console.error('Budget analysis error:', error);
    res.status(500).json({ error: 'Failed to generate budget analysis' });
  }
});

module.exports = router;
