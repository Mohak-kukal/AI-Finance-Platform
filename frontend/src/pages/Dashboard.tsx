import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { 
  DollarSign, 
  TrendingDown, 
  CreditCard,
  Receipt,
  Target,
  RefreshCw
} from 'lucide-react'
import { 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'
import { apiClient } from '../lib/api'
import { Account, Transaction, BudgetAnalysis, InsightsData } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getChartColors } from '@/lib/chart-colors'
import { useTheme } from '@/components/ThemeProvider'

export function Dashboard() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([])
  const [budgetAnalysis, setBudgetAnalysis] = useState<BudgetAnalysis[]>([])
  const [insights, setInsights] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const location = useLocation()
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  const isDark = mounted && (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
  const chartColors = getChartColors(isDark)

  // Reload when navigating to dashboard
  useEffect(() => {
    loadDashboardData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Also reload when window regains focus (user might have added transactions in another tab)
  useEffect(() => {
    const handleFocus = () => {
      if (location.pathname === '/dashboard') {
        loadDashboardData()
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const loadDashboardData = async () => {
    setLoading(true)
    try {
      // Load essential data first (fast)
      const [
        accountsRes,
        transactionsRes,
        budgetRes
      ] = await Promise.all([
        apiClient.getAccounts(),
        apiClient.getTransactions({ limit: 10 }),
        apiClient.getBudgetAnalysis()
      ])

      setAccounts(accountsRes.accounts)
      setRecentTransactions(transactionsRes.transactions)
      setBudgetAnalysis(budgetRes.analysis)
      setLoading(false)

      // Load insights in background (slow, but don't block UI)
      try {
        const insightsRes = await apiClient.getInsights({ months: 6 }).catch(err => {
          console.warn('Failed to load insights:', err)
          return null
        })
        console.log('Insights data received:', insightsRes) // Debug log
        setInsights(insightsRes)
      } catch (error) {
        console.error('Error loading insights:', error)
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error)
      setLoading(false)
    }
  }

  const totalBalance = accounts.reduce((sum, account) => sum + (typeof account.balance === 'number' ? account.balance : parseFloat(String(account.balance)) || 0), 0)
  const monthlySpending = recentTransactions
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)

  const spendingByCategory = (insights?.top_categories || [])
    .filter(cat => cat.category && cat.total < 0) // Only include valid categories with expenses
    .map(cat => ({
      name: cat.category || 'Uncategorized',
      value: Math.abs(Number(cat.total)),
      count: cat.count
    })) || []
  
  console.log('Spending by category processed:', spendingByCategory) // Debug log

  const monthlyTrend = (insights?.spending_trends || [])
    .filter(trend => trend.total < 0) // Only include months with expenses
    .map(trend => {
      // Handle different date formats from database
      const monthValue = trend.month as any
      const date = monthValue instanceof Date 
        ? monthValue 
        : new Date(monthValue)
      return {
        month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        amount: Math.abs(Number(trend.total))
      }
    }) || []
  
  console.log('Monthly trend processed:', monthlyTrend) // Debug log

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your financial overview.</p>
        </div>
        <Button
          onClick={() => loadDashboardData()}
          variant="outline"
          size="sm"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                <DollarSign className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Total Balance</p>
                <p className="text-2xl font-bold text-foreground">₹{Number(totalBalance || 0).toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
                <TrendingDown className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Monthly Spending</p>
                <p className="text-2xl font-bold text-foreground">₹{monthlySpending.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                <CreditCard className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Accounts</p>
                <p className="text-2xl font-bold text-foreground">{accounts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                <Target className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Active Budgets</p>
                <p className="text-2xl font-bold text-foreground">{budgetAnalysis.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spending by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Spending by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {spendingByCategory.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                <div className="text-center">
                  <p className="text-lg mb-2">No spending data available</p>
                  <p className="text-sm">Add expense transactions with categories to see spending breakdown</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={spendingByCategory}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill={chartColors[0]}
                    dataKey="value"
                  >
                    {spendingByCategory.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value) => [`₹${Number(value).toFixed(2)}`, 'Amount']}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 'calc(var(--radius) - 2px)',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    itemStyle={{
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    labelStyle={{
                      color: 'hsl(var(--popover-foreground))',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Monthly Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Spending Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                <div className="text-center">
                  <p className="text-lg mb-2">No spending trends available</p>
                  <p className="text-sm">Add expense transactions to see monthly spending patterns</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    stroke="hsl(var(--border))"
                    opacity={0.3}
                  />
                  <XAxis 
                    dataKey="month" 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip 
                    formatter={(value) => [`₹${Number(value).toFixed(2)}`, 'Amount']}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 'calc(var(--radius) - 2px)',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    itemStyle={{
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    labelStyle={{
                      color: 'hsl(var(--popover-foreground))',
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="amount" 
                    stroke={chartColors[0]} 
                    strokeWidth={2}
                    dot={{ fill: chartColors[0], r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Budget Status */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {budgetAnalysis.map((budget) => (
              <div key={budget.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-foreground capitalize">{budget.category}</span>
                    <Badge
                      variant={
                        budget.status === 'over' ? 'destructive' :
                        budget.status === 'warning' ? 'secondary' : 'default'
                      }
                    >
                      {budget.status === 'over' ? 'Over Budget' :
                       budget.status === 'warning' ? 'Near Limit' : 'On Track'}
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    <span>Spent: ₹{Number(budget.spent || 0).toFixed(2)}</span>
                    <span>Budget: ₹{Number(budget.limit_amount || 0).toFixed(2)}</span>
                    <span>Remaining: ₹{Number(budget.remaining || 0).toFixed(2)}</span>
                  </div>
                  <div className="mt-2 bg-secondary rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        budget.status === 'over' ? 'bg-destructive' :
                        budget.status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(Number(budget.percentage || 0), 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentTransactions.slice(0, 5).map((transaction) => (
              <div key={transaction.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center">
                  <div className="p-2 bg-secondary rounded-lg mr-3">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {transaction.merchant || transaction.description || 'Unknown'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {transaction.category && (
                        <span className="capitalize">{transaction.category}</span>
                      )}
                      {transaction.account_name && (
                        <span className="ml-2">• {transaction.account_name}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${
                    transaction.amount < 0 ? 'text-destructive' : 'text-green-600'
                  }`}>
                    {transaction.amount < 0 ? '-' : '+'}₹{Math.abs(transaction.amount).toFixed(2)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(transaction.date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
