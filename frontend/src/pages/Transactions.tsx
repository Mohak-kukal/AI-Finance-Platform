import React, { useState, useEffect } from 'react'
import { Plus, Upload, Edit, Trash2, Receipt, Search, Filter } from 'lucide-react'
import { apiClient } from '../lib/api'
import { Transaction, Account } from '../types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [formData, setFormData] = useState({
    account_id: 0,
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    merchant: '',
    description: '',
    category: ''
  })
  const [isExpense, setIsExpense] = useState(true)
  const [filters, setFilters] = useState({
    account_id: '',
    category: '',
    start_date: '',
    end_date: ''
  })
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [transactionsRes, accountsRes] = await Promise.all([
        apiClient.getTransactions({ limit: 50 }),
        apiClient.getAccounts()
      ])
      setTransactions(transactionsRes.transactions)
      setAccounts(accountsRes.accounts)
      // If no account selected, default to first account
      if ((formData.account_id === 0 || !formData.account_id) && accountsRes.accounts.length > 0) {
        setFormData({ ...formData, account_id: accountsRes.accounts[0].id })
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setErrorMsg('')
      if (!formData.account_id || formData.account_id <= 0) {
        setErrorMsg('Please select an account')
        return
      }
      const amt = Math.abs(Number(formData.amount) || 0)
      const finalAmount = isExpense ? -amt : amt

      if (editingTransaction) {
        await apiClient.updateTransaction(editingTransaction.id, { ...formData, amount: finalAmount })
      } else {
        await apiClient.createTransaction({ ...formData, amount: finalAmount })
      }
      setShowForm(false)
      setEditingTransaction(null)
      setFormData({
        account_id: 0,
        date: new Date().toISOString().split('T')[0],
        amount: 0,
        merchant: '',
        description: '',
        category: ''
      })
      setIsExpense(true)
      loadData()
      setSuccessMsg('Transaction saved')
      setTimeout(() => setSuccessMsg(''), 2000)
    } catch (error) {
      console.error('Error saving transaction:', error)
      setErrorMsg((error as any)?.response?.data?.error || 'Failed to save transaction')
    }
  }

  const handleEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction)
    setFormData({
      account_id: transaction.account_id,
      date: transaction.date,
      amount: transaction.amount,
      merchant: transaction.merchant || '',
      description: transaction.description || '',
      category: transaction.category || ''
    })
    setIsExpense((transaction.amount || 0) < 0)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this transaction?')) {
      try {
        await apiClient.deleteTransaction(id)
        loadData()
      } catch (error) {
        console.error('Error deleting transaction:', error)
      }
    }
  }

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingReceipt(true)
    try {
      const result = await apiClient.uploadReceipt(file)
      // Handle both shapes: {success, data:{...}} or direct fields
      const extracted = (result as any)?.data?.data || (result as any)?.data || result
      if (extracted && (extracted.merchant || extracted.total_amount || extracted.date)) {
        // Build description from items if available
        let description = ''
        if (extracted.items && Array.isArray(extracted.items) && extracted.items.length > 0) {
          description = extracted.items.map((item: any) => item.description || '').filter(Boolean).join(', ')
        }
        
        // Normalize category to lowercase to match Select values
        let normalizedCategory = ''
        if (extracted.category) {
          const categoryLower = extracted.category.toLowerCase().trim()
          // Map common variations to our category values
          const categoryMap: Record<string, string> = {
            'food': 'food',
            'restaurant': 'food',
            'dining': 'food',
            'groceries': 'food',
            'transportation': 'transportation',
            'transport': 'transportation',
            'travel': 'travel',
            'shopping': 'shopping',
            'retail': 'shopping',
            'entertainment': 'entertainment',
            'utilities': 'utilities',
            'utility': 'utilities',
            'healthcare': 'healthcare',
            'health': 'healthcare',
            'medical': 'healthcare',
            'education': 'education',
            'insurance': 'insurance',
            'other': 'other'
          }
          normalizedCategory = categoryMap[categoryLower] || categoryLower
        }
        
        // Set all form data at once to avoid overwriting
        const newFormData = {
          account_id: accounts.length === 1 ? accounts[0].id : formData.account_id || 0,
          merchant: extracted.merchant || '',
          date: extracted.date || new Date().toISOString().split('T')[0],
          amount: -(Number(extracted.total_amount) || 0), // Negative for expense
          category: normalizedCategory,
          description: description || extracted.description || ''
        }
        setFormData(newFormData)
        setShowForm(true)
      } else {
        // Fallback: open empty form with today's date
        setErrorMsg('Could not extract fields from receipt. Please fill manually.')
        setFormData({
          ...formData,
          account_id: accounts.length === 1 ? accounts[0].id : formData.account_id || 0,
          date: new Date().toISOString().split('T')[0],
        })
        setShowForm(true)
      }
    } catch (error: any) {
      console.error('Error uploading receipt:', error)
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Failed to process receipt'
      setErrorMsg(`${errorMessage}. You can enter details manually.`)
      // Open form anyway to allow manual entry
      setFormData({
        ...formData,
        account_id: accounts.length === 1 ? accounts[0].id : formData.account_id || 0,
        date: new Date().toISOString().split('T')[0],
      })
      setShowForm(true)
    } finally {
      setUploadingReceipt(false)
    }
  }

  const filteredTransactions = transactions.filter(transaction => {
    if (filters.account_id && filters.account_id !== 'all' && transaction.account_id !== parseInt(filters.account_id)) return false
    if (filters.category && filters.category !== 'all' && transaction.category !== filters.category) return false
    if (filters.start_date && transaction.date < filters.start_date) return false
    if (filters.end_date && transaction.date > filters.end_date) return false
    return true
  })

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
          <h1 className="text-3xl font-bold text-foreground">Transactions</h1>
          <p className="text-muted-foreground">Track your income and expenses</p>
        </div>
        <div className="flex space-x-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={handleReceiptUpload}
            className="hidden"
            disabled={uploadingReceipt}
          />
          <Button 
            variant="default" 
            className="bg-green-600 hover:bg-green-700" 
            type="button" 
            disabled={uploadingReceipt}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Receipt
          </Button>
          <Button
            onClick={() => {
              if (accounts.length > 0) {
                setFormData(prev => ({ ...prev, account_id: prev.account_id || accounts[0].id }))
              }
              setShowForm(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Transaction
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 px-4 py-2 rounded mb-4">
          {successMsg}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Account</Label>
              <Select
                value={filters.account_id || undefined}
                onValueChange={(value) => setFilters({ ...filters, account_id: value === 'all' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {accounts.map(account => (
                    <SelectItem key={account.id} value={String(account.id)}>{account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={filters.category || undefined}
                onValueChange={(value) => setFilters({ ...filters, category: value === 'all' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
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
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={filters.start_date}
                onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={filters.end_date}
                onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Account
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTransactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-muted/50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {new Date(transaction.date).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {transaction.merchant || transaction.description || 'Unknown'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant="secondary" className="capitalize">
                      {transaction.category || 'uncategorized'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {transaction.account_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`font-medium ${
                      transaction.amount < 0 ? 'text-destructive' : 'text-green-600'
                    }`}>
                      {transaction.amount < 0 ? '-' : '+'}₹{Math.abs(transaction.amount).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(transaction)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(transaction.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add/Edit Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTransaction ? 'Edit Transaction' : 'Add New Transaction'}
            </DialogTitle>
          </DialogHeader>
          {errorMsg && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded text-sm">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">Account</Label>
              <Select
                value={String(formData.account_id)}
                onValueChange={(value) => setFormData({ ...formData, account_id: parseInt(value) })}
              >
                <SelectTrigger id="account">
                  <SelectValue placeholder="Select Account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(account => (
                    <SelectItem key={account.id} value={String(account.id)}>{account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => {
                  const v = e.target.value
                  const normalized = v.replace(/^(-?)0+(\d)/, '$1$2')
                  setFormData({ ...formData, amount: Number(normalized) || 0 })
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <RadioGroup value={isExpense ? 'expense' : 'income'} onValueChange={(value) => setIsExpense(value === 'expense')}>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="expense" id="expense" />
                    <Label htmlFor="expense" className="cursor-pointer">Expense</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="income" id="income" />
                    <Label htmlFor="income" className="cursor-pointer">Income</Label>
                  </div>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merchant">Merchant</Label>
              <Input
                id="merchant"
                type="text"
                value={formData.merchant}
                onChange={(e) => setFormData({ ...formData, merchant: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={formData.category || undefined}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select Category (optional)" />
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
            <div className="flex space-x-3 pt-4">
              <Button
                type="submit"
                className="flex-1"
              >
                {editingTransaction ? 'Update' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false)
                  setEditingTransaction(null)
                  setFormData({
                    account_id: 0,
                    date: new Date().toISOString().split('T')[0],
                    amount: 0,
                    merchant: '',
                    description: '',
                    category: ''
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
