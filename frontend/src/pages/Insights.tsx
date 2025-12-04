import React, { useState, useEffect } from 'react'
import { 
  Brain,
  AlertCircle,
  CheckCircle,
  RefreshCw
} from 'lucide-react'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts'
import { apiClient } from '../lib/api'
import { InsightsData, AIAdvice, Prediction } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getChartColors } from '@/lib/chart-colors'
import { useTheme } from '@/components/ThemeProvider'
import { useUser } from '@clerk/clerk-react'

export function Insights() {
  const [insights, setInsights] = useState<InsightsData | null>(null)
  const [aiAdvice, setAiAdvice] = useState<AIAdvice | null>(null)
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [predictionMonth, setPredictionMonth] = useState<number | null>(null)
  const [predictionYear, setPredictionYear] = useState<number | null>(null)
  const [predictionInsufficientData, setPredictionInsufficientData] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adviceLoading, setAdviceLoading] = useState(false)
  const [predictionsLoading, setPredictionsLoading] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState(6)
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const { user } = useUser()
  
  useEffect(() => {
    setMounted(true)
    
    // Get current user ID
    const currentUserId = user?.id || null
    
    // Check if stored data belongs to current user
    const storedUserId = sessionStorage.getItem('insights_user_id')
    
    // If user changed or no user ID stored, clear old data
    if (currentUserId && storedUserId && storedUserId !== currentUserId) {
      sessionStorage.removeItem('insights_advice')
      sessionStorage.removeItem('insights_predictions')
      sessionStorage.removeItem('insights_prediction_month')
      sessionStorage.removeItem('insights_prediction_year')
      setAiAdvice(null)
      setPredictions([])
      setPredictionMonth(null)
      setPredictionYear(null)
      setPredictionInsufficientData(null)
    }
    
    // Only restore data if it belongs to current user
    if (currentUserId && (!storedUserId || storedUserId === currentUserId)) {
      const savedAdvice = sessionStorage.getItem('insights_advice')
      const savedPredictions = sessionStorage.getItem('insights_predictions')
      
      if (savedAdvice) {
        try {
          setAiAdvice(JSON.parse(savedAdvice))
        } catch (e) {
          console.warn('Failed to restore advice:', e)
        }
      }
      
      if (savedPredictions) {
        try {
          setPredictions(JSON.parse(savedPredictions))
          // Restore month and year from sessionStorage
          const savedMonth = sessionStorage.getItem('insights_prediction_month')
          const savedYear = sessionStorage.getItem('insights_prediction_year')
          if (savedMonth) setPredictionMonth(parseInt(savedMonth, 10))
          if (savedYear) setPredictionYear(parseInt(savedYear, 10))
        } catch (e) {
          console.warn('Failed to restore predictions:', e)
        }
      }
      
      // Store current user ID
      if (currentUserId) {
        sessionStorage.setItem('insights_user_id', currentUserId)
      }
    } else if (!currentUserId) {
      // No user logged in, clear all data
      sessionStorage.removeItem('insights_advice')
      sessionStorage.removeItem('insights_predictions')
      sessionStorage.removeItem('insights_prediction_month')
      sessionStorage.removeItem('insights_prediction_year')
      sessionStorage.removeItem('insights_user_id')
      setAiAdvice(null)
      setPredictions([])
      setPredictionMonth(null)
      setPredictionYear(null)
      setPredictionInsufficientData(null)
    }
  }, [user?.id])
  
  const isDark = mounted && (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
  const chartColors = getChartColors(isDark)

  useEffect(() => {
    loadInsights()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod])

  // Reload insights when window regains focus (but not AI features)
  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        loadInsights()
      }
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadInsights = async () => {
    setLoading(true)
    try {
      // Load insights only (AI features are loaded manually via buttons)
      const insightsRes = await apiClient.getInsights({ months: selectedPeriod }).catch(err => {
        console.warn('Failed to load insights:', err)
        return null
      })
      console.log('Insights data received:', insightsRes) // Debug log
      setInsights(insightsRes)
    } catch (error) {
      console.error('Error loading insights:', error)
    } finally {
      setLoading(false)
    }
  }

  const [streamingAdvice, setStreamingAdvice] = useState<Partial<AIAdvice> | null>(null)
  const [streamingText, setStreamingText] = useState('')

  // Helper function to parse partial JSON incrementally
  const parsePartialJSON = (text: string): Partial<AIAdvice> => {
    const advice: Partial<AIAdvice> = {
      summary: '',
      concerns: [],
      recommendations: [],
      positive_feedback: [],
      next_steps: [],
      confidence_score: 0
    }

    try {
      // Try to extract summary
      const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/)
      if (summaryMatch) {
        advice.summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
      }

      // Try to extract concerns array
      const concernsMatch = text.match(/"concerns"\s*:\s*\[(.*?)\]/s)
      if (concernsMatch) {
        try {
          const concernsStr = concernsMatch[1]
          const concernMatches = concernsStr.matchAll(/"([^"]*(?:\\.[^"]*)*)"/g)
          advice.concerns = Array.from(concernMatches, m => m[1].replace(/\\"/g, '"'))
        } catch (e) {
          // Partial parsing
        }
      }

      // Try to extract recommendations
      const recsMatch = text.match(/"recommendations"\s*:\s*\[(.*?)\]/s)
      if (recsMatch) {
        try {
          const recsStr = recsMatch[1]
          const recMatches = recsStr.matchAll(/\{[^}]*"title"\s*:\s*"([^"]*)"[^}]*"description"\s*:\s*"([^"]*)"[^}]*\}/g)
          advice.recommendations = Array.from(recMatches, m => ({
            title: m[1],
            description: m[2] || '',
            priority: 'medium' as const,
            potential_savings: ''
          }))
        } catch (e) {
          // Partial parsing
        }
      }

      // Try to extract positive_feedback
      const feedbackMatch = text.match(/"positive_feedback"\s*:\s*\[(.*?)\]/s)
      if (feedbackMatch) {
        try {
          const feedbackStr = feedbackMatch[1]
          const feedbackMatches = feedbackStr.matchAll(/"([^"]*(?:\\.[^"]*)*)"/g)
          advice.positive_feedback = Array.from(feedbackMatches, m => m[1].replace(/\\"/g, '"'))
        } catch (e) {
          // Partial parsing
        }
      }

      // Try to extract next_steps
      const stepsMatch = text.match(/"next_steps"\s*:\s*\[(.*?)\]/s)
      if (stepsMatch) {
        try {
          const stepsStr = stepsMatch[1]
          const stepMatches = stepsStr.matchAll(/"([^"]*(?:\\.[^"]*)*)"/g)
          advice.next_steps = Array.from(stepMatches, m => m[1].replace(/\\"/g, '"'))
        } catch (e) {
          // Partial parsing
        }
      }

      // Try to extract confidence_score
      const confidenceMatch = text.match(/"confidence_score"\s*:\s*(\d+)/)
      if (confidenceMatch) {
        advice.confidence_score = parseInt(confidenceMatch[1], 10)
      }
    } catch (e) {
      // Continue with partial data
    }

    return advice
  }

  const generateAdvice = async () => {
    setAdviceLoading(true)
    setStreamingText('')
    setStreamingAdvice(null)
    setAiAdvice(null) // Clear previous advice
    
    try {
      // Try streaming API first
      try {
        let accumulatedText = ''
        await apiClient.getAdviceStream(
          undefined,
          // onChunk - accumulate text and parse incrementally
          (chunk: string) => {
            accumulatedText += chunk
            setStreamingText(accumulatedText)
            // Try to parse partial JSON and update advice in real-time
            const partialAdvice = parsePartialJSON(accumulatedText)
            if (partialAdvice.summary || partialAdvice.concerns?.length || partialAdvice.recommendations?.length) {
              setStreamingAdvice(partialAdvice as Partial<AIAdvice>)
            }
          },
          // onComplete - parse final JSON and display structured advice
          (adviceData: AIAdvice) => {
            console.log('AI Advice complete:', adviceData)
            setAiAdvice(adviceData)
            setStreamingText('') // Clear streaming text
            setStreamingAdvice(null)
            // Save to sessionStorage with user ID
            if (user?.id) {
              sessionStorage.setItem('insights_advice', JSON.stringify(adviceData))
              sessionStorage.setItem('insights_user_id', user.id)
            }
            setAdviceLoading(false)
          },
          // onError - fallback to non-streaming
          async (error: string) => {
            console.warn('Streaming failed, falling back to regular API:', error)
            // Fallback to regular API
            try {
              const adviceRes = await apiClient.getAdvice().catch(err => {
                console.warn('Failed to load AI advice:', err)
                return null
              })
              
              if (adviceRes) {
                const adviceData = (adviceRes as any).advice || adviceRes
                setAiAdvice(adviceData)
                if (user?.id) {
                  sessionStorage.setItem('insights_advice', JSON.stringify(adviceData))
                  sessionStorage.setItem('insights_user_id', user.id)
                }
              } else {
                setAiAdvice(null)
                sessionStorage.removeItem('insights_advice')
              }
            } catch (fallbackError) {
              console.error('Fallback also failed:', fallbackError)
              setAiAdvice(null)
              sessionStorage.removeItem('insights_advice')
            } finally {
              setStreamingText('')
              setStreamingAdvice(null)
              setAdviceLoading(false)
            }
          }
        )
      } catch (streamError) {
        // If streaming fails to start, use regular API
        console.warn('Streaming not available, using regular API:', streamError)
        const adviceRes = await apiClient.getAdvice().catch(err => {
          console.warn('Failed to load AI advice:', err)
          return null
        })
        
        if (adviceRes) {
          const adviceData = (adviceRes as any).advice || adviceRes
          setAiAdvice(adviceData)
          if (user?.id) {
            sessionStorage.setItem('insights_advice', JSON.stringify(adviceData))
            sessionStorage.setItem('insights_user_id', user.id)
          }
        } else {
          setAiAdvice(null)
          sessionStorage.removeItem('insights_advice')
        }
        setStreamingText('')
        setStreamingAdvice(null)
        setAdviceLoading(false)
      }
    } catch (error) {
      console.error('Error generating advice:', error)
      setAiAdvice(null)
      setStreamingText('')
      setStreamingAdvice(null)
      sessionStorage.removeItem('insights_advice')
      setAdviceLoading(false)
    }
  }

  const generatePredictions = async () => {
    setPredictionsLoading(true)
    try {
      const predictionsRes = await apiClient.getPredictions().catch(err => {
        console.warn('Failed to load predictions:', err)
        return null
      })
      console.log('Predictions response:', predictionsRes) // Debug log
      
      if (predictionsRes) {
        // Check if it's an error response with insufficient_data
        if (predictionsRes.insufficient_data === true || (predictionsRes.predictions && predictionsRes.predictions.length === 0 && predictionsRes.insufficient_data)) {
          setPredictions([])
          setPredictionMonth(null)
          setPredictionYear(null)
          setPredictionInsufficientData(predictionsRes.message || 'Insufficient data for predictions. Please add at least 15 transactions to enable AI predictions.')
          sessionStorage.removeItem('insights_predictions')
        } else if (predictionsRes.predictions && Array.isArray(predictionsRes.predictions)) {
          setPredictions(predictionsRes.predictions)
          setPredictionInsufficientData(null) // Clear insufficient data message
          // Extract month and year from response metadata or calculate 2 months ahead
          let month = (predictionsRes as any).target_month
          let year = (predictionsRes as any).target_year
          
          if (!month || !year) {
            // Calculate 2 months ahead from current date, handling year wrapping
            const now = new Date()
            const currentMonth = now.getMonth() // 0-11 (0-based)
            const currentYear = now.getFullYear()
            const monthsAhead = 2
            
            // Calculate target month (0-based)
            const targetMonth0Based = currentMonth + monthsAhead
            // Convert to 1-based and handle year wrapping
            if (targetMonth0Based >= 12) {
              month = targetMonth0Based - 12 + 1 // Convert to 1-based, wrapped month
              year = currentYear + 1 // Next year
            } else {
              month = targetMonth0Based + 1 // Convert to 1-based (1-12)
              year = currentYear
            }
          }
          
          setPredictionMonth(month)
          setPredictionYear(year)
          // Save to sessionStorage with user ID
          if (user?.id) {
            sessionStorage.setItem('insights_predictions', JSON.stringify(predictionsRes.predictions))
            sessionStorage.setItem('insights_prediction_month', month.toString())
            sessionStorage.setItem('insights_prediction_year', year.toString())
            sessionStorage.setItem('insights_user_id', user.id)
          }
        } else {
          // If response structure is different, try to extract predictions
          setPredictions([])
          setPredictionMonth(null)
          setPredictionYear(null)
          setPredictionInsufficientData(null)
          sessionStorage.removeItem('insights_predictions')
        }
      } else {
        setPredictions([])
        setPredictionMonth(null)
        setPredictionYear(null)
        setPredictionInsufficientData(null)
        sessionStorage.removeItem('insights_predictions')
      }
    } catch (error) {
      console.error('Error loading predictions:', error)
      setPredictions([])
      setPredictionMonth(null)
      setPredictionYear(null)
      setPredictionInsufficientData(null)
      sessionStorage.removeItem('insights_predictions')
    } finally {
      setPredictionsLoading(false)
    }
  }

  const topMerchants = (insights?.top_merchants ?? []).map(merchant => ({
    name: merchant.merchant,
    amount: Math.abs(merchant.total),
    count: merchant.count
  })) || []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }


  // Use streaming advice if available, otherwise use final advice
  const displayAdvice = streamingAdvice || aiAdvice
  
  const safeAdvice = displayAdvice && !displayAdvice.error
    ? {
        ...displayAdvice,
        summary: displayAdvice.summary || '',
        concerns: Array.isArray(displayAdvice.concerns) ? displayAdvice.concerns : [],
        recommendations: Array.isArray(displayAdvice.recommendations) ? displayAdvice.recommendations : [],
        positive_feedback: Array.isArray(displayAdvice.positive_feedback) ? displayAdvice.positive_feedback : [],
        next_steps: Array.isArray((displayAdvice as any).next_steps) ? (displayAdvice as any).next_steps : [],
        confidence_score: displayAdvice.confidence_score || 0,
      }
    : null

  console.log('Safe advice constructed:', safeAdvice) // Debug log
  console.log('Predictions state:', predictions) // Debug log

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Insights</h1>
          <p className="text-muted-foreground">AI-powered financial analysis and predictions</p>
        </div>
        <div className="flex items-center space-x-4">
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              loadInsights()
            }}
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <label className="text-sm font-medium text-foreground">Period:</label>
          <select
            value={selectedPeriod}
            onChange={(e) => {
              e.stopPropagation()
              setSelectedPeriod(parseInt(e.target.value))
            }}
            onClick={(e) => e.stopPropagation()}
            className="px-3 py-2 border border-input bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
        </div>
      </div>

      {/* Top Merchants */}
      <Card>
        <CardHeader>
          <CardTitle>Top Merchants</CardTitle>
        </CardHeader>
        <CardContent>
          {topMerchants.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              <div className="text-center">
                <p className="text-lg mb-2">No merchant data available</p>
                <p className="text-sm">Add expense transactions with merchants to see top spending locations</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topMerchants.slice(0, 10)}>
                <CartesianGrid 
                  strokeDasharray="3 3" 
                  stroke="hsl(var(--border))"
                  opacity={0.3}
                />
                <XAxis 
                  dataKey="name" 
                  angle={-45} 
                  textAnchor="end" 
                  height={100}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
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
                />
                <Bar 
                  dataKey="amount" 
                  fill={chartColors[0]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* AI Predictions */}
      <Card onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Brain className="h-6 w-6 text-primary mr-2" />
              <CardTitle>AI Spending Predictions</CardTitle>
            </div>
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                generatePredictions()
              }}
              disabled={predictionsLoading}
              variant="outline"
              size="sm"
            >
              {predictionsLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate Prediction
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {predictionsLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="ml-3 text-muted-foreground">Generating predictions...</span>
            </div>
          )}
          {!predictionsLoading && predictions.length === 0 && !predictionInsufficientData && (
            <div className="p-6 bg-muted/50 rounded-lg text-center">
              <p className="text-muted-foreground mb-4">
                Click "Generate Prediction" to get AI-powered spending predictions based on your transaction history.
              </p>
              <p className="text-sm text-muted-foreground">
                Note: You need at least 15 transactions to generate accurate predictions.
              </p>
            </div>
          )}
          {!predictionsLoading && predictionInsufficientData && (
            <div>
              <p className="text-black dark:text-foreground leading-relaxed">
                {predictionInsufficientData}
              </p>
            </div>
          )}
          {!predictionsLoading && predictions.length > 0 && (() => {
            // Filter out predictions with amount 0
            const filteredPredictions = predictions.filter(p => Number(p.predicted_amount || 0) > 0)
            
            if (filteredPredictions.length === 0) {
              return (
                <div>
                  <p className="text-black dark:text-foreground leading-relaxed">
                    No predictions available with non-zero amounts.
                  </p>
                </div>
              )
            }
            
            return (
              <div className="space-y-3">
                <p className="text-foreground mb-4">
                  Based on your spending patterns, here are the predicted expenses for the upcoming month:
                </p>
                <ul className="space-y-2 text-foreground">
                  {filteredPredictions.map((prediction, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                      <span>
                        <span className="font-medium capitalize">{prediction.category}</span>
                        {' '}spending is predicted to be{' '}
                        <span className="font-semibold text-primary">
                          ₹{Number(prediction.predicted_amount || 0).toFixed(2)}
                        </span>
                        {(() => {
                          const month = predictionMonth || prediction.month
                          const year = predictionYear || prediction.year
                          if (month && year && !isNaN(month) && !isNaN(year) && month >= 1 && month <= 12) {
                            const date = new Date(year, month - 1)
                            if (!isNaN(date.getTime())) {
                              return (
                                <>
                                  {' '}for{' '}
                                  {date.toLocaleDateString('en-US', { 
                                    month: 'long', 
                                    year: 'numeric' 
                                  })}.
                                </>
                              )
                            }
                          }
                          return null
                        })()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* AI Financial Advice */}
      <Card onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Brain className="h-6 w-6 text-primary mr-2" />
              <CardTitle>AI Financial Advice</CardTitle>
            </div>
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                generateAdvice()
              }}
              disabled={adviceLoading}
              variant="outline"
              size="sm"
            >
              {adviceLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate Advice
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {adviceLoading && streamingAdvice && (
            <div className="space-y-3">
              <div className="mb-2 flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                <span className="text-sm text-muted-foreground">Generating advice...</span>
              </div>
              
              {streamingAdvice.summary && (
                <p className="text-foreground mb-4">
                  {streamingAdvice.summary}
                  <span className="animate-pulse">▋</span>
                </p>
              )}

              {streamingAdvice.concerns && streamingAdvice.concerns.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Key Concerns:</p>
                  <ul className="space-y-2 text-foreground">
                    {streamingAdvice.concerns.map((concern, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>
                          {concern}
                          {index === streamingAdvice.concerns!.length - 1 && <span className="animate-pulse">▋</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {streamingAdvice.recommendations && streamingAdvice.recommendations.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Top Recommendations:</p>
                  <ul className="space-y-2 text-foreground">
                    {streamingAdvice.recommendations.map((rec, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>
                          <span className="font-medium">{rec.title || `Recommendation ${index + 1}`}</span>
                          {rec.description && (
                            <>
                              {': '}
                              {rec.description}
                            </>
                          )}
                          {rec.potential_savings && (
                            <span className="ml-1">
                              (Potential savings: {rec.potential_savings})
                            </span>
                          )}
                          {index === streamingAdvice.recommendations!.length - 1 && <span className="animate-pulse">▋</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {streamingAdvice.positive_feedback && streamingAdvice.positive_feedback.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Positive Highlights:</p>
                  <ul className="space-y-2 text-foreground">
                    {streamingAdvice.positive_feedback.map((feedback, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>
                          {feedback}
                          {index === streamingAdvice.positive_feedback!.length - 1 && <span className="animate-pulse">▋</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {streamingAdvice.next_steps && streamingAdvice.next_steps.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Next Steps:</p>
                  <ul className="space-y-2 text-foreground">
                    {streamingAdvice.next_steps.map((step, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>
                          {step}
                          {index === streamingAdvice.next_steps!.length - 1 && <span className="animate-pulse">▋</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {adviceLoading && !streamingAdvice && !streamingText && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="ml-3 text-muted-foreground">Starting AI advice generation...</span>
            </div>
          )}
          {adviceLoading && !streamingAdvice && streamingText && (
            <div className="py-4">
              <div className="mb-2 flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                <span className="text-sm text-muted-foreground">Processing...</span>
              </div>
            </div>
          )}
          {!adviceLoading && !safeAdvice && !streamingAdvice && (
            <div className="p-6 bg-muted/50 rounded-lg text-center">
              <p className="text-muted-foreground mb-4">
                Click "Generate Advice" to get personalized AI-powered financial advice based on your spending patterns.
              </p>
              <p className="text-sm text-muted-foreground">
                Note: You need at least 10 transactions to generate accurate advice.
              </p>
            </div>
          )}
          {!adviceLoading && safeAdvice && (safeAdvice as any).insufficient_data && (
            <div>
              <p className="text-black dark:text-foreground leading-relaxed">
                {safeAdvice.summary || 'We need at least 10 transactions to generate accurate financial advice. Add more transactions to unlock personalized AI financial advice.'}
              </p>
            </div>
          )}
          {!adviceLoading && safeAdvice && !(safeAdvice as any).insufficient_data && (
            <div className="space-y-3">
              <div className="flex items-center justify-end mb-4">
                {safeAdvice.confidence_score > 0 && (
                  <Badge variant="secondary">
                    {safeAdvice.confidence_score}% confidence
                  </Badge>
                )}
              </div>
              
              {safeAdvice.summary && (
                <p className="text-foreground mb-4">
                  {safeAdvice.summary}
                </p>
              )}

              {safeAdvice.concerns && safeAdvice.concerns.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Key Concerns:</p>
                  <ul className="space-y-2 text-foreground">
                    {safeAdvice.concerns.slice(0, 3).map((concern, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {safeAdvice.recommendations && safeAdvice.recommendations.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Top Recommendations:</p>
                  <ul className="space-y-2 text-foreground">
                    {safeAdvice.recommendations.slice(0, 5).map((rec, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>
                          <span className="font-medium">{rec.title || `Recommendation ${index + 1}`}</span>
                          {rec.description && (
                            <>
                              {': '}
                              {rec.description}
                            </>
                          )}
                          {rec.potential_savings && (
                            <span className="ml-1">
                              (Potential savings: {rec.potential_savings})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {safeAdvice.positive_feedback && safeAdvice.positive_feedback.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Positive Highlights:</p>
                  <ul className="space-y-2 text-foreground">
                    {safeAdvice.positive_feedback.slice(0, 3).map((feedback, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>{feedback}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {safeAdvice.next_steps && safeAdvice.next_steps.length > 0 && (
                <div>
                  <p className="text-foreground mb-2">Next Steps:</p>
                  <ul className="space-y-2 text-foreground">
                    {safeAdvice.next_steps.slice(0, 5).map((step, index) => (
                      <li key={index} className="flex items-start">
                        <span className="mr-2 text-primary font-bold">{index + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Show message if advice exists but no sections have data */}
              {!safeAdvice.summary && 
               (!safeAdvice.concerns || safeAdvice.concerns.length === 0) && 
               (!safeAdvice.recommendations || safeAdvice.recommendations.length === 0) && 
               (!safeAdvice.positive_feedback || safeAdvice.positive_feedback.length === 0) &&
               (!safeAdvice.next_steps || safeAdvice.next_steps.length === 0) && (
                <div className="p-4 bg-muted/50 rounded-lg text-center">
                  <p className="text-muted-foreground">
                    AI advice is being generated. Please check back in a moment or refresh the page.
                  </p>
                </div>
              )}
            </div>
          )}
          </CardContent>
        </Card>
    </div>
  )
}
