import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { 
  AuthResponse, 
  User, 
  Account, 
  Transaction, 
  TransactionsResponse, 
  Budget, 
  BudgetAnalysis,
  Prediction,
  InsightsData,
  AIAdvice,
  OCRResult,
  CategorizationResult
} from '../types'

// Token getter function - will be set by Clerk auth hook
let tokenGetter: (() => Promise<string | null>) | null = null

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter
}

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
      timeout: 10000,
    })

    // Add request interceptor to include auth token from Clerk
    this.client.interceptors.request.use(async (config) => {
      try {
        if (tokenGetter) {
          const token = await tokenGetter()
          if (token) {
            config.headers.Authorization = `Bearer ${token}`
          }
        }
      } catch (error) {
        // If Clerk is not initialized or user not signed in, continue without token
      }
      return config
    })

      // Add response interceptor to handle errors
      this.client.interceptors.response.use(
        (response) => response,
        (error) => {
          // Handle rate limiting (429) errors
          if (error?.response?.status === 429) {
            const retryAfter = error?.response?.headers['retry-after'] || 15
            console.warn(`Rate limit exceeded. Retry after ${retryAfter} seconds.`)
          }
          // Do NOT auto-clear auth on any transient backend error.
          // Surface error to the UI and let pages handle it gracefully.
          return Promise.reject(error)
        }
      )
  }

  // Auth endpoints
  async register(name: string, email: string, password: string): Promise<AuthResponse> {
    const response = await this.client.post('/auth/register', { name, email, password })
    return response.data
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.client.post('/auth/login', { email, password })
    return response.data
  }

  async getCurrentUser(): Promise<{ user: User }> {
    const response = await this.client.get('/auth/me')
    return response.data
  }

  // Account endpoints
  async getAccounts(): Promise<{ accounts: Account[] }> {
    const response = await this.client.get('/accounts')
    return response.data
  }

  async createAccount(name: string, type: string, balance: number): Promise<{ account: Account }> {
    const response = await this.client.post('/accounts', { name, type, balance })
    return response.data
  }

  async updateAccount(id: number, updates: Partial<Account>): Promise<{ account: Account }> {
    const response = await this.client.put(`/accounts/${id}`, updates)
    return response.data
  }

  async deleteAccount(id: number): Promise<void> {
    await this.client.delete(`/accounts/${id}`)
  }

  // Transaction endpoints
  async getTransactions(params?: {
    page?: number
    limit?: number
    account_id?: number
    category?: string
    start_date?: string
    end_date?: string
  }): Promise<TransactionsResponse> {
    const response = await this.client.get('/transactions', { params })
    return response.data
  }

  async createTransaction(transaction: {
    account_id: number
    date: string
    amount: number
    merchant?: string
    description?: string
    category?: string
  }): Promise<{ transaction: Transaction }> {
    const response = await this.client.post('/transactions', transaction)
    return response.data
  }

  async updateTransaction(id: number, updates: Partial<Transaction>): Promise<{ transaction: Transaction }> {
    const response = await this.client.put(`/transactions/${id}`, updates)
    return response.data
  }

  async deleteTransaction(id: number): Promise<void> {
    await this.client.delete(`/transactions/${id}`)
  }

  async uploadReceipt(file: File): Promise<OCRResult> {
    const formData = new FormData()
    formData.append('receipt', file)
    const response = await this.client.post('/transactions/uploadReceipt', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000 // 60 seconds for OCR processing
    })
    return response.data
  }

  // Budget endpoints
  async getBudgets(params?: { month?: number; year?: number }): Promise<{ budgets: Budget[] }> {
    const response = await this.client.get('/budgets', { params })
    return response.data
  }

  async createBudget(budget: {
    category: string
    limit_amount: number
    month: number
    year: number
  }): Promise<{ budget: Budget }> {
    const response = await this.client.post('/budgets', budget)
    return response.data
  }

  async updateBudget(id: number, updates: Partial<Budget>): Promise<{ budget: Budget }> {
    const response = await this.client.put(`/budgets/${id}`, updates)
    return response.data
  }

  async deleteBudget(id: number): Promise<void> {
    await this.client.delete(`/budgets/${id}`)
  }

  async getBudgetAnalysis(params?: { month?: number; year?: number }): Promise<{ analysis: BudgetAnalysis[] }> {
    const response = await this.client.get('/budgets/analysis', { params })
    return response.data
  }

  // AI endpoints
  async categorizeTransaction(merchant?: string, description?: string, amount?: number): Promise<CategorizationResult> {
    const response = await this.client.post('/ai/categorize', { merchant, description, amount })
    return response.data
  }

  async trainModel(transaction_id: number, old_category: string, new_category: string): Promise<void> {
    await this.client.post('/ai/train', { transaction_id, old_category, new_category })
  }

  async getPredictions(params?: { month?: number; year?: number }): Promise<{ predictions: Prediction[] }> {
    const response = await this.client.get('/ai/predict', { 
      params,
      timeout: 60000 // 60 seconds for AI processing
    })
    return response.data
  }

  async getAdvice(params?: { month?: number; year?: number }): Promise<AIAdvice> {
    const response = await this.client.post('/ai/advice', params, {
      timeout: 60000 // 60 seconds for AI processing
    })
    // Handle response structure: { success: true, advice: {...} } or direct advice object
    if (response.data && response.data.advice) {
      return response.data.advice
    }
    return response.data
  }

  async getAdviceStream(
    params: { month?: number; year?: number } | undefined,
    onChunk: (text: string) => void,
    onComplete: (advice: AIAdvice) => void,
    onError: (error: string) => void
  ): Promise<void> {
    // Get token from tokenGetter
    let token: string | null = null
    if (tokenGetter) {
      try {
        token = await tokenGetter()
      } catch (e) {
        console.warn('Failed to get token:', e)
      }
    }
    
    const baseURL = this.client.defaults.baseURL || import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
    const url = `${baseURL}/ai/advice/stream`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify(params || {}),
    })

    // Check content type - might be JSON if insufficient data
    const contentType = response.headers.get('content-type') || ''
    
    if (!response.ok) {
      const errorText = await response.text()
      onError(`HTTP error! status: ${response.status} - ${errorText}`)
      return
    }

    // If response is JSON (not SSE), handle it directly
    if (contentType.includes('application/json')) {
      try {
        const jsonData = await response.json()
        // Handle both direct advice object and wrapped response
        const adviceData = jsonData.advice || jsonData
        onComplete(adviceData)
        return
      } catch (e) {
        onError('Failed to parse JSON response')
        return
      }
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    if (!reader) {
      onError('No response body reader available')
      return
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          // If we have remaining buffer, try to parse it
          if (buffer.trim()) {
            try {
              // Try to parse as JSON if it looks like JSON
              if (buffer.trim().startsWith('{')) {
                const jsonData = JSON.parse(buffer.trim())
                const adviceData = jsonData.advice || jsonData
                onComplete(adviceData)
                return
              }
            } catch (e) {
              // Not JSON, continue with SSE parsing
            }
          }
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.type === 'chunk') {
                onChunk(data.text)
              } else if (data.type === 'complete') {
                const adviceData = data.advice || data
                onComplete(adviceData)
                return
              } else if (data.type === 'error') {
                onError(data.error || 'Unknown error')
                return
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e, line)
            }
          } else if (line.trim() && line.trim().startsWith('{')) {
            // Handle case where JSON is sent without 'data: ' prefix
            try {
              const data = JSON.parse(line.trim())
              if (data.insufficient_data || data.summary) {
                onComplete(data)
                return
              }
            } catch (e) {
              // Not valid JSON, continue
            }
          }
        }
      }
    } catch (error: any) {
      onError(error.message || 'Stream reading error')
    }
  }

  async getInsights(params?: { months?: number }): Promise<InsightsData> {
    const response = await this.client.get('/ai/insights', { params })
    return response.data
  }
}

export const apiClient = new ApiClient()
