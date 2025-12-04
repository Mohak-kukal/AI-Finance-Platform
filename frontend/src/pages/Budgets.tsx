import React, { useState, useEffect } from 'react'
import { Plus, Edit, Trash2, Target, AlertCircle, CheckCircle, TrendingUp } from 'lucide-react'
import { apiClient } from '../lib/api'
import { Budget, BudgetAnalysis } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

export function Budgets() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [budgetAnalysis, setBudgetAnalysis] = useState<BudgetAnalysis[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    category: '',
    limit_amount: 0,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  })
  const [budgetType, setBudgetType] = useState<'category' | 'monthly'>('category')

  useEffect(() => {
    loadBudgets()
  }, [])

  const loadBudgets = async () => {
    try {
      const [budgetsRes, analysisRes] = await Promise.all([
        apiClient.getBudgets(),
        apiClient.getBudgetAnalysis()
      ])
      setBudgets(budgetsRes.budgets)
      setBudgetAnalysis(analysisRes.analysis)
    } catch (error) {
      console.error('Error loading budgets:', error)
    } finally {
      setLoading(false)
    }
  }


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (budgetType === 'category' && !formData.category) {
      setError('Please select a category')
      return
    }
    
    if (formData.limit_amount <= 0) {
      setError('Limit amount must be greater than 0')
      return
    }
    
    try {
      // For monthly budgets, use 'monthly' as the category
      const category = budgetType === 'monthly' ? 'monthly' : formData.category
      
      if (editingBudget) {
        await apiClient.updateBudget(editingBudget.id, {
          ...formData,
          category
        })
      } else {
        await apiClient.createBudget({
          category,
          limit_amount: formData.limit_amount,
          month: formData.month,
          year: formData.year
        })
      }
      setShowForm(false)
      setEditingBudget(null)
      setError(null)
      setBudgetType('category')
      setFormData({
        category: '',
        limit_amount: 0,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      })
      loadBudgets()
    } catch (error: any) {
      console.error('Error saving budget:', error)
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || 'Failed to save budget. Please try again.'
      setError(errorMessage)
    }
  }

  const handleEdit = (budget: Budget) => {
    setEditingBudget(budget)
    const isMonthly = budget.category === 'monthly'
    setBudgetType(isMonthly ? 'monthly' : 'category')
    setFormData({
      category: isMonthly ? '' : budget.category,
      limit_amount: budget.limit_amount,
      month: budget.month,
      year: budget.year
    })
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this budget?')) {
      try {
        await apiClient.deleteBudget(id)
        loadBudgets()
      } catch (error) {
        console.error('Error deleting budget:', error)
      }
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'over':
        return <AlertCircle className="h-5 w-5 text-red-500" />
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />
      default:
        return <CheckCircle className="h-5 w-5 text-green-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'over':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
      case 'warning':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      default:
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Budgets</h1>
          <p className="text-muted-foreground">Set and track your spending limits</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Budget
        </Button>
      </div>

      {/* Budget Analysis Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {budgetAnalysis.map((analysis) => (
          <Card key={analysis.id} className={getStatusColor(analysis.status)}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <div className="p-2 bg-background rounded-lg mr-3">
                    <Target className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground capitalize">
                      {analysis.category === 'monthly' ? 'Monthly Budget' : analysis.category}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(analysis.year, analysis.month - 1).toLocaleDateString('en-US', { 
                        month: 'long', 
                        year: 'numeric' 
                      })}
                    </p>
                  </div>
                </div>
                {getStatusIcon(analysis.status)}
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-medium text-foreground">₹{Number(analysis.spent || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Budget</span>
                  <span className="font-medium text-foreground">₹{Number(analysis.limit_amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {Number(analysis.remaining || 0) < 0 ? 'Exceeded by' : 'Remaining'}
                  </span>
                  <span className={`font-medium ${
                    Number(analysis.remaining || 0) < 0 ? 'text-destructive' : 'text-green-600'
                  }`}>
                    {Number(analysis.remaining || 0) < 0 
                      ? `₹${Math.abs(Number(analysis.remaining || 0)).toFixed(2)}`
                      : `₹${Number(analysis.remaining || 0).toFixed(2)}`
                    }
                  </span>
                </div>
                
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>{Number(analysis.percentage || 0).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        analysis.status === 'over' ? 'bg-destructive' :
                        analysis.status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(Number(analysis.percentage || 0), 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(analysis)}
                  className="flex-1"
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(analysis.id)}
                  className="flex-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Budget Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">
                {budgetAnalysis.filter(b => b.status === 'good').length}
              </div>
              <div className="text-sm text-muted-foreground">On Track</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {budgetAnalysis.filter(b => b.status === 'warning').length}
              </div>
              <div className="text-sm text-muted-foreground">Near Limit</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-destructive">
                {budgetAnalysis.filter(b => b.status === 'over').length}
              </div>
              <div className="text-sm text-muted-foreground">Over Budget</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingBudget ? 'Edit Budget' : 'Add New Budget'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Budget Type</Label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="budgetType"
                    value="category"
                    checked={budgetType === 'category'}
                    onChange={(e) => {
                      setBudgetType('category')
                      setFormData(prev => ({ ...prev, category: '' }))
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Category Budget</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="budgetType"
                    value="monthly"
                    checked={budgetType === 'monthly'}
                    onChange={(e) => {
                      setBudgetType('monthly')
                      setFormData(prev => ({ ...prev, category: '' }))
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Monthly Budget</span>
                </label>
              </div>
            </div>
            {budgetType === 'category' && (
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category || undefined}
                  onValueChange={(value) => {
                    setFormData({ ...formData, category: value })
                  }}
                >
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="food">Food</SelectItem>
                  <SelectItem value="transportation">Transportation</SelectItem>
                  <SelectItem value="shopping">Shopping</SelectItem>
                  <SelectItem value="entertainment">Entertainment</SelectItem>
                  <SelectItem value="utilities">Utilities</SelectItem>
                  <SelectItem value="healthcare">Healthcare</SelectItem>
                  <SelectItem value="education">Education</SelectItem>
                  <SelectItem value="travel">Travel</SelectItem>
                  <SelectItem value="insurance">Insurance</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="limit">Limit Amount</Label>
              <Input
                id="limit"
                type="number"
                step="0.01"
                min="0"
                value={formData.limit_amount === 0 ? '' : formData.limit_amount}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '' || !isNaN(parseFloat(value))) {
                    setFormData({ ...formData, limit_amount: value === '' ? 0 : parseFloat(value) })
                  }
                }}
                placeholder="0.00"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="month">Month</Label>
                <Select
                  value={String(formData.month)}
                  onValueChange={(value) => {
                    const newMonth = parseInt(value)
                    setFormData({ ...formData, month: newMonth })
                  }}
                >
                  <SelectTrigger id="month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                      <SelectItem key={month} value={String(month)}>
                        {new Date(0, month - 1).toLocaleDateString('en-US', { month: 'long' })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Select
                  value={String(formData.year)}
                  onValueChange={(value) => {
                    const newYear = parseInt(value)
                    setFormData({ ...formData, year: newYear })
                  }}
                >
                  <SelectTrigger id="year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
                      <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex space-x-3 pt-4">
              <Button
                type="submit"
                className="flex-1"
              >
                {editingBudget ? 'Update' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false)
                  setEditingBudget(null)
                  setError(null)
                  setBudgetType('category')
                  setFormData({
                    category: '',
                    limit_amount: 0,
                    month: new Date().getMonth() + 1,
                    year: new Date().getFullYear()
                  })
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
