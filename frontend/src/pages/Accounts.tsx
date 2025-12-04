import React, { useState, useEffect } from 'react'
import { Plus, Edit, Trash2, CreditCard, DollarSign } from 'lucide-react'
import { apiClient } from '../lib/api'
import { Account } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    type: 'checking' as const,
    balance: '' as number | string
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const response = await apiClient.getAccounts()
      setAccounts(response.accounts)
    } catch (error) {
      console.error('Error loading accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    
    try {
      const balanceValue = typeof formData.balance === 'string' 
        ? (formData.balance === '' ? 0 : parseFloat(formData.balance) || 0)
        : formData.balance

      if (editingAccount) {
        await apiClient.updateAccount(editingAccount.id, {
          name: formData.name,
          type: formData.type,
          balance: balanceValue
        })
        setSuccess('Account updated successfully!')
      } else {
        await apiClient.createAccount(formData.name, formData.type, balanceValue)
        setSuccess('Account created successfully!')
      }
      
      setTimeout(() => {
        setShowForm(false)
        setEditingAccount(null)
        setFormData({ name: '', type: 'checking', balance: '' })
        setSuccess(null)
        loadAccounts()
      }, 1000)
    } catch (error: any) {
      console.error('Error saving account:', error)
      if (error?.response?.status === 429) {
        setError('Too many requests. Please wait a moment and try again.')
      } else {
        setError(error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Failed to save account. Please try again.')
      }
    }
  }

  const handleEdit = (account: Account) => {
    setEditingAccount(account)
    setFormData({
      name: account.name,
      type: account.type,
      balance: account.balance
    })
    setError(null)
    setSuccess(null)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this account?')) {
      try {
        await apiClient.deleteAccount(id)
        loadAccounts()
      } catch (error) {
        console.error('Error deleting account:', error)
      }
    }
  }

  const totalBalance = accounts.reduce((sum, account) => sum + (typeof account.balance === 'number' ? account.balance : parseFloat(String(account.balance)) || 0), 0)

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
          <h1 className="text-3xl font-bold text-foreground">Accounts</h1>
          <p className="text-muted-foreground">Manage your financial accounts</p>
        </div>
        <Button
          onClick={() => {
            setShowForm(true)
            setError(null)
            setSuccess(null)
            setFormData({ name: '', type: 'checking', balance: '' })
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      {/* Total Balance Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
              <DollarSign className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Balance</p>
              <p className="text-3xl font-bold text-foreground">₹{Number(totalBalance || 0).toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <div className="p-2 bg-muted rounded-lg mr-3">
                    <CreditCard className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{account.name}</h3>
                    <p className="text-sm text-muted-foreground capitalize">{account.type}</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEdit(account)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(account.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-foreground">₹{Number((account as any).balance || 0).toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">
                  Created {new Date(account.created_at).toLocaleDateString()}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add/Edit Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? 'Edit Account' : 'Add New Account'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 px-4 py-3 rounded-md text-sm">
                {success}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="account-name">Account Name</Label>
              <Input
                id="account-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-type">Account Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value as any })}
              >
                <SelectTrigger id="account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="balance">Initial Balance</Label>
              <Input
                id="balance"
                type="number"
                step="0.01"
                value={formData.balance}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '' || !isNaN(parseFloat(value))) {
                    setFormData({ ...formData, balance: value === '' ? '' : value })
                  }
                }}
                placeholder="0.00"
              />
            </div>
            <div className="flex space-x-3 pt-4">
              <Button
                type="submit"
                className="flex-1"
              >
                {editingAccount ? 'Update' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false)
                  setEditingAccount(null)
                  setFormData({ name: '', type: 'checking', balance: '' })
                  setError(null)
                  setSuccess(null)
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
